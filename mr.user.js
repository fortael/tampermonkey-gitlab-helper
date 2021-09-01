// ==UserScript==
// @name        Gitlab merge requests highlight
// @namespace   Review
// @description Highlight available merge request
// @version     0.3.0
// @homepage    https://github.com/fortael/tampermonkey-gitlab-helper
// @updateUrl   https://cdn.jsdelivr.net/gh/fortael/tampermonkey-gitlab-helper@latest/mr.meta.js
// @downloadURL https://cdn.jsdelivr.net/gh/fortael/tampermonkey-gitlab-helper@latest/mr.user.js
// @match       https://*/*/merge_requests*
// @require     https://unpkg.com/axios/dist/axios.min.js
// @require     https://cdn.jsdelivr.net/npm/lodash@4.17.15/lodash.min.js
// @grant       none
// @run-at      document-end
// ==/UserScript==

// eslint-disable-next-line no-unused-vars
/* global axios, _, timeago, document, window, gl, gon */

const urlSearchParams = new URLSearchParams(window.location.search);
const query = Object.fromEntries(urlSearchParams.entries());
const state = _.get(query, 'state', 'opened');

const mrMap = {};
const upVotesForCanBeMerged = 2;
const toTestLabels = ['toTest', 'To test'];
const testDoneLabels = ['testDone', 'Tested'];
const buttonsList = [];

// REQUESTS
// -/////////////////////////////////////////////////////////////////////////////////////////////////////

const fetchMe = () => axios.get('/api/v4/user').then((response) => {
	return _.get(response, 'data');
}).catch(console.error);

const fetchLabels = (projectId) => axios.get(`/api/v4/projects/${projectId}/labels`).then((response) => {
	return _.get(response, 'data', null);
}).catch(console.error);

const getMe = fetchMe();

const fetchProjectByName = async (name) => axios.get(`/api/v4/search?scope=projects&search=${name}`)
	.then(async (response) => {
		const data = _.get(response, 'data');
		if (_.isEmpty(data)) return {};

		return _.first(_.filter(data, project => project.name === name));
	})
	.catch(console.error);

const fetchDiscussionsByMergeRequestRequest = (projectId, mergeRequestIid) => axios({
	url: `/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`,
}).then((response) => {
	const data = _.get(response, 'data');

	return _.isEmpty(data) ? [] : data;
}).catch(console.error);

// PARSING
// -/////////////////////////////////////////////////////////////////////////////////////////////////////

const getMergeIdsByUserReactionEmoji = (projectId = null) => axios({
	url: projectId
		? `/api/v4/projects/${projectId}/merge_requests?my_reaction_emoji=Any`
		: '/api/v4/merge_requests?my_reaction_emoji=Any',
}).then((response) => {
	const data = _.get(response, 'data').filter((item) => item.state === 'opened').map((item) => item.iid);

	return _.isEmpty(data) ? [] : data;
}).catch(console.error);

const setDiscussionInfo = async (mergeRequest) => {
	const discussions = await fetchDiscussionsByMergeRequestRequest(mergeRequest.projectId, mergeRequest.id);
	if (_.isEmpty(discussions)) return mergeRequest;

	mergeRequest.hasDiscussionByUser = discussions.filter((discussion) => {
		return !discussion.individual_note && discussion.notes.filter((note) => {
			return note.author.id === mergeRequest.currentUserId;
		}).length > 0;
	}).length > 0;

	const awaitDiscussions = discussions
		.map(note => note.notes.filter(discussion => discussion.resolvable && !discussion.resolved))
		.filter(value => !_.isEmpty(value));

	/* collapse discussions */
	const flattenAwaitDiscussions = _.flatten(awaitDiscussions);
	const uniqDiscussions = flattenAwaitDiscussions.reduce((carry, item) => {
		const name = item.author.username;

		// eslint-disable-next-line no-prototype-builtins
		if (!carry.hasOwnProperty(name) || new Date(carry[name].created_at) < new Date(item.created_at)) {
			carry[name] = item;
		}

		return carry;
	}, {});

	mergeRequest.awaitDiscussionsList = Object.values(uniqDiscussions);
	mergeRequest.hasOpenedDiscussions = mergeRequest.awaitDiscussionsList.length > 0;

	return mergeRequest;
};

const getTime = (element) => Date.parse(element.querySelector('time').getAttribute('datetime'));

/**
 * @param {Element} element
 * @return {boolean}
 */
const hasToTestLabel = (element) => {
	return Array.from(element.querySelectorAll('.gl-label-text'))
		.filter(elem => toTestLabels.includes(elem.textContent.trim()))
		.length > 0;
};

/**
 * @param {Element} element
 * @return {boolean}
 */
const hasTestDoneLabel = (element) => {
	return Array.from(element.querySelectorAll('.badge'))
		.filter(elem => testDoneLabels.includes(elem.textContent.trim()))
		.length > 0;
};

const hasMergeConflictsMark = (mr) => mr.querySelectorAll('.issuable-pipeline-broken').length > 0;
const isWip = mr => mr.querySelector('.merge-request-title-text a').textContent.includes('WIP');
const isMergeRequestPage = () => document.querySelectorAll('.merge-request-tabs').length > 0;
const getIssuableReference = mr => mr.querySelector('.issuable-reference').textContent.replace(/\D/g, '');
const getMergeRequestTitleTextElement = mr => mr.querySelector('.merge-request-title-text');
const getMergeDescription = mr => mr.querySelector('.issuable-info');
const getLikes = mr => parseInt(_.get(mr.querySelector('.issuable-upvotes'), 'textContent', 0), 0) || 0;

const getCurrentProjectName = () => {
	const locationPath = window.location.pathname.split('/');
	if (locationPath.length < 2) {
		return null;
	}

	return locationPath[locationPath.length - 3];
};

// VISUALIZE
// -/////////////////////////////////////////////////////////////////////////////////////////////////////

const highlightWhichIsReady = (mergeRequest) => {
	if (!mergeRequest.isReady()) return;

	mergeRequest.element.style.backgroundColor = 'rgb(223, 245, 212)';
	mergeRequest.element.style.borderLeft = '5px solid rgb(19, 144, 16)';
	mergeRequest.element.removeAttribute('title');
};

const highlightPipelines = (mergeRequest) => {
	if (mergeRequest.isWip) return;

	const isPipelineSuccess = mergeRequest.element.querySelectorAll('.ci-status-icon-success').length > 0;
	const isPipelineRunning = mergeRequest.element.querySelectorAll('.ci-status-icon-running').length > 0;

	if (isPipelineSuccess || isPipelineRunning) return;

	const isPipelineFailed = mergeRequest.element.querySelectorAll('.ci-status-icon-success-with-warnings').length > 0;

	if (isPipelineFailed) {
		mergeRequest.element.style.borderRight = '3px dotted #fc9403';

		return;
	}
	mergeRequest.element.style.borderRight = '3px dotted rgb(207, 207, 207)';
};

const highlightWhichIsAlmostReady = (mergeRequest) => {
	if (!mergeRequest.isAlmostReady()) return;

	mergeRequest.element.style.backgroundColor = '#fdf9f0';
	mergeRequest.element.style.borderLeft = '5px solid #ff9c00';
	mergeRequest.element.setAttribute('title', 'Only 1 like to go');
};

const highlightWhichIsOld = (mergeRequest) => {
	if (mergeRequest.isReady()) return;
	if (mergeRequest.isAlmostReady()) return;
	if (mergeRequest.hasMergeConflictsMark) return;

	const twoWeeks = (20166) * 60 * 1000;
	const nowTime = (new Date()).getTime();

	if ((nowTime - mergeRequest.time) > twoWeeks) {
		mergeRequest.element.style.backgroundColor = 'rgb(234, 234, 234)';
		mergeRequest.element.style.borderLeft = '5px solid rgb(104, 104, 104)';
		mergeRequest.element.setAttribute('title', 'Is pretty old');
	}
};

const highlightWhichIsConflicts = (mergeRequest) => {
	if (!mergeRequest.hasMergeConflictsMark) return;

	mergeRequest.element.style.backgroundColor = 'rgb(255, 245, 245)';
	mergeRequest.element.style.borderLeft = '5px solid rgb(217, 83, 79)';
	mergeRequest.element.setAttribute('title', 'Has some problems');
};

const highlightWIP = (mergeRequest) => {
	if (!mergeRequest.isWip) return;

	mergeRequest.element.style.opacity = '0.5';
};

const highlightWhichIsLiked = (mergeRequest) => {
	if (mergeRequest.liked) {
		mergeRequest.element.querySelector('.issuable-upvotes').style.color = 'rgb(16, 113, 14)';
	}
};

const highlightWhichIsDiscussed = (mergeRequest) => {
	if (mergeRequest.awaitDiscussionsList.length > 0) {
		mergeRequest.element.querySelector('.issuable-comments i').style.color = '#D9534F';
		mergeRequest.element.style.backgroundColor = '#fff';
		mergeRequest.element.style.borderLeft = '0';
	}
};

/**
 * @param {Array<object>} mergeRequests
 * @param {string} match
 */
const filterWithClassMatch = (mergeRequests, match) => {
	mergeRequests.forEach(mr => {
		const hasClass = mr.element.querySelectorAll(match).length > 0;

		if (hasClass) {
			mr.element.style.display = 'block';
		}
		else {
			mr.element.style.display = 'none';
		}
	});
};

/**
 * @param {Array<object>} mergeRequests
 */
const filterReady = (mergeRequests) => {
	mergeRequests.forEach(mr => {
		const isPipelineSuccess = mr.element.querySelectorAll('.ci-status-icon-success').length > 0;
		const isReady = isPipelineSuccess
			&& mr.likes >= 2
			&& !mr.isWip
			&& !mr.hasMergeConflictsMark
			&& !mr.hasOpenedDiscussions
			&& !mr.hasToTestLabel;

		if (isReady) {
			mr.element.style.display = 'block';
		}
		else {
			mr.element.style.display = 'none';
		}
	});
};

// -/////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 * @param projectId
 * @param user
 * @param {Element} mergeRow
 * @param likedMergeRequestIds
 * @return {Object}
 */
const buildMergeRequest = (projectId = null, user = null, mergeRow, likedMergeRequestIds = []) => {
	const mergeRequestIid = getIssuableReference(mergeRow);
	const likedByMe = likedMergeRequestIds.indexOf(parseInt(mergeRequestIid)) !== -1;
	const comments = parseInt(mergeRow.querySelector('.issuable-comments a').textContent.replaceAll(/(\D)+/g, ''));

	const mergeRequest = {
		hasToTestLabel: hasToTestLabel(mergeRow),
		hasTestDoneLabel: hasTestDoneLabel(mergeRow),
		hasMergeConflictsMark: hasMergeConflictsMark(mergeRow),
		likes: getLikes(mergeRow),
		isWip: isWip(mergeRow),
		time: getTime(mergeRow),
		element: mergeRow,
		id: mergeRequestIid,
		projectId: projectId,
		currentUserId: user ? user.id : null,
		awaitDiscussionsList: [],
		liked: likedByMe,

		isReady: function() {
			if (!this.hasPassedTesting()) return false;
			if (this.likes < 2 || this.isWip) return false;

			return !this.hasMergeConflictsMark;
		},
		isAlmostReady: function() {
			if (this.hasMergeConflictsMark) return false;
			if (!this.hasPassedTesting()) return false;

			return !(this.likes < 1 || this.isWip);
		},
		hasPassedTesting: function() {
			return this.hasTestDoneLabel || !this.hasToTestLabel;
		},
	};
	if (!projectId) return mergeRequest;
	if (comments === 0) return mergeRequest;

	return setDiscussionInfo(mergeRequest).catch(() => mergeRequest);
};

const decorateMergeRequest = (mergeRequest) => {
	mergeRequest.element.style.backgroundColor = '#fff';
	mergeRequest.element.style.borderLeft = '5px solid #fff';

	const mergeRequestTitleTextElement = getMergeRequestTitleTextElement(mergeRequest.element);
	const mergeRequestDescElement = getMergeDescription(mergeRequest.element);
	const currentNameMergeRequest = mergeRequestTitleTextElement.innerHTML;
	const mrTitle = [];

	if (mergeRequest.hasOpenedDiscussions) {
		const badgeUnresolvedDiscussions = `
            <span
                class="badge color-label has-tooltip"
                style="background-color: #D9534F; color: #FFFFFF"
                title=""
                data-container="body"
                data-original-title="Merge-request has unresolved discussions"
            >
                UD
            </span>`;

		const discussionLabel = (name, username, userLink, avatar, time) => {
			const elem = document.createElement('div');

			elem.innerHTML = `
				<a class="author-link has-tooltip" data-container="body" href="${userLink}">
					<img class="avatar avatar-inline s16 js-lazy-loaded qa-js-lazy-loaded" alt="${name}'s avatar" src="${avatar}" loading="lazy" width="16">
				</a>
				<a class="author-link js-user-link  " data-user-id="78" data-username="${username}" data-name="${name}" href="${userLink}" title=""><span class="author">${name}</span></a>
				<time class="js-timeago" title="${time}" datetime="${time}" data-toggle="tooltip" data-placement="bottom" data-container="body" data-original-title="${time}"></time>
            `;

			return elem;
		};

		mrTitle.push(badgeUnresolvedDiscussions);

		const discussionsPanel = document.createElement('div');

		discussionsPanel.classList.add('issuable-info');
		discussionsPanel.classList.add('small');

		mergeRequest.awaitDiscussionsList.forEach(discussion => {
			discussionsPanel.append(discussionLabel(
				discussion.author.name,
				discussion.author.username,
				discussion.author.web_url,
				discussion.author.avatar_url,
				discussion.created_at,
			));
		});

		mergeRequestDescElement.after(discussionsPanel);
	}

	mrTitle.push(currentNameMergeRequest);
	mergeRequestTitleTextElement.innerHTML = mrTitle.join(' ');

	highlightWhichIsAlmostReady(mergeRequest);
	highlightWhichIsOld(mergeRequest);
	highlightWhichIsConflicts(mergeRequest);
	highlightWIP(mergeRequest);
	highlightWhichIsReady(mergeRequest);
	highlightWhichIsLiked(mergeRequest);
	highlightWhichIsDiscussed(mergeRequest);
	highlightPipelines(mergeRequest);
};

const processMergeRequests = async (projectId = null, user = null, likedMergeRequestIds = []) => {
	document.querySelectorAll('.merge-request').forEach((element) => {
		(async () => {
			const mergeRow = element;
			const mr = await buildMergeRequest(projectId, user, mergeRow, likedMergeRequestIds);

			mergeRow.setAttribute('data-merge-id', mr.id);
			mrMap[mr.id] = mr;

			decorateMergeRequest(mr);
		})();
	});
};

const getLikesCount = () => {
	const button = document.querySelector('.award-emoji-block .js-counter')
		|| document.querySelector('.js-emoji-btn .js-counter');

	return parseInt(button.textContent);
};

const mergeRequestLogic = () => {
	if (getLikesCount() < upVotesForCanBeMerged) {
		setTimeout(() => {
			const $btn = document.querySelector('.mr-widget-body button');

			$btn.classList.remove('btn-success');
			$btn.classList.add('btn-warning');
			$btn.setAttribute('title', `Likes sess than ${upVotesForCanBeMerged}`);
		}, 1000);
	}
};

const drawButtons = async () => {
	const $queries = document.querySelector('.custom-panel__queries');

	buttonsList.textContent = '';
	buttonsList.forEach(btn => $queries.appendChild(btn));
};

const drawFilters = async () => {
	const allIcons = Array.from(document.querySelectorAll('.ci-status-link'))
		.reduce((accumulator, value) => {
			const svg = value.innerHTML;
			const title = value.attributes.title.nodeValue;
			const className = value.className.match(/.*(ci-status-icon-(.+))\s/)[1].replace('has-tooltip', '').trim();

			accumulator[className] = { svg, className, title };

			return accumulator;
		}, {});

	const pipelineButtons = Object.values(allIcons).map((value) => {
		return `
			<button data-match=".${value.className}" class="js-filter btn btn-default btn-sm has-tooltip ${value.className}" title="${value.title}" data-placement="top">
				${value.svg}
			</button>
		`;
	});

	const $filters = document.querySelector('.custom-panel__filters');

	$filters.innerHTML = `
		${pipelineButtons.join('')}
		<button data-match=".title" class="js-filter btn btn-default btn-sm has-tooltip" data-placement="top" href="#" title="All">
			All
		</button>
		<button data-match=".badge" class="js-filter btn btn-sm btn-default has-tooltip" data-placement="top" href="#" title="With discussions">
			<span class="badge color-label has-tooltip" style="background-color: #D9534F; color: #FFFFFF; padding: 0 0.5rem" data-container="body">UD</span>
		</button>
		<button data-find="ready" class="js-filter btn btn-default btn-sm ci-status-icon-failed has-tooltip" data-placement="top" href="#" title="Ready to release">
			Ready
		</button>
	`;
};

const createButton = (name, url) => {
	const elem = document.createElement('span');
	const href = document.createElement('a');

	href.href = url;
	href.className = 'btn btn-default btn-sm';
	href.innerText = name;

	elem.className = 'pr-1';
	elem.append(href);

	return elem;
};

const showCustomToolbar = async () => {
	const customPanel = document.createElement('div');

	customPanel.className = 'custom-panel pt-2 pb-2 row';
	customPanel.innerHTML = `
		<div class="custom-panel__queries col-7"></div>
		<div class="custom-panel__filters col-5 text-right"></div>
	`;

	document.querySelector('.issues-filters').after(customPanel);

	const author = gon.current_username;
	const buttons = [
		createButton('My MRs', '?scope=all&utf8=✓&state=' + state + '&author_username=' + author),
		createButton('To review', '?scope=all&utf8=✓&state=' + state + '&not[my_reaction_emoji]=thumbsup&wip=no&target_branch=master&not[approved_by_usernames][]=' + author + '&not[author_username]=' + author),
		createButton('Assignee', '?scope=all&utf8=✓&state=' + state + '&assignee_username=' + author),
		createButton('Master', '?scope=all&utf8=✓&state=' + state + '&target_branch=master'),
		createButton('Not master', '?scope=all&utf8=✓&state=' + state + '&not[target_branch]=master'),
		createButton('No WIP', '?scope=all&utf8=✓&state=' + state + '&wip=no'),
		createButton('Liked', '?scope=all&utf8=✓&state=' + state + '&my_reaction_emoji=thumbsup'),
	];
	buttonsList.push(...buttons);

	drawButtons().then();
	drawFilters().then();

	const $jsFilterBtn = document.querySelectorAll('.js-filter');

	$jsFilterBtn.forEach(btn => btn.setAttribute('disabled', 'disabled'));

	document.querySelector('.custom-panel__filters').addEventListener('click', event => {
		const target = event.target.closest('.js-filter');

		if (target) {
			const button = target;
			const match = button.dataset['match'];
			const find = button.dataset['find'];

			$jsFilterBtn.forEach(btn => btn.classList.remove('active'));
			button.classList.add('active');

			if (match) {
				filterWithClassMatch(Object.values(mrMap), match);

				return;
			}

			if (find && find === 'ready') {
				filterReady(Object.values(mrMap));
			}
		}
	});
	$jsFilterBtn.forEach(btn => btn.removeAttribute('disabled'));

};

const showToTestQueries = async (projectId) => {
	const labels = await fetchLabels(projectId);
	const toTestLabel = labels.filter(label => toTestLabels.includes(label.name)).pop();
	const testedLabel = labels.filter(label => testDoneLabels.includes(label.name)).pop();

	if (toTestLabel) {
		const $toTestBtn = createButton('To test', '?scope=all&utf8=✓&state=' + state + '&label_name[]=' + toTestLabel.name);

		$toTestBtn.setAttribute('title', toTestLabel.description);
		$toTestBtn.setAttribute('data-placement', 'top');
		$toTestBtn.classList.add('has-tooltip');

		buttonsList.push($toTestBtn);
	}
	if (testedLabel) {
		const $testedBtn = createButton('Tested', '?scope=all&utf8=✓&state=' + state + '&label_name[]=' + testedLabel.name);

		$testedBtn.setAttribute('title', testedLabel.description);
		$testedBtn.setAttribute('data-placement', 'top');
		$testedBtn.classList.add('has-tooltip');

		buttonsList.push($testedBtn);
	}

	drawButtons().then();
};

async function start() {
	if (isMergeRequestPage()) {
		mergeRequestLogic();

		return;
	}

	const currentProject = getCurrentProjectName();
	if (!currentProject) return;

	showCustomToolbar().then();

	const project = await fetchProjectByName(currentProject);
	const projectId = _.get(project, 'id') || null;

	showToTestQueries(projectId).then();

	const me = await getMe;
	const likedMergeRequestIds = await getMergeIdsByUserReactionEmoji(projectId);
	processMergeRequests(projectId, me, likedMergeRequestIds).then();

	if (timeago) {
		setTimeout(() => {
			timeago.render(document.querySelectorAll('.js-timeago'));
		}, 3000);
	}
}

start().then();
