// ==UserScript==
// @name        Gitlab merge requests highlight
// @namespace   Review
// @description Highlight available merge request
// @version     0.2.0
// @updateUrl   https://github.com/fortael/tampermonkey-gitlab-helper/raw/master/mr.meta.js
// @downloadURL https://github.com/fortael/tampermonkey-gitlab-helper/raw/master/mr.user.js
// @match       https://*/*/merge_requests*
// @require     http://code.jquery.com/jquery-latest.js
// @require     https://unpkg.com/axios/dist/axios.min.js
// @require     https://cdn.jsdelivr.net/npm/lodash@4.17.15/lodash.min.js
// @grant       none
// ==/UserScript==

/* global axios, $, _, timeago, document, window */

const map = {};
const upVotesForCanBeMerged = 2;
const toTestLabels = ['toTest', 'To test'];
const testDoneLabels = ['testDone', 'Tested'];

const getMe = () => axios.get('/api/v4/user').then((response) => {
	return _.get(response, 'data');
}).catch((error) => console.log(error));

const getProjectByName = (name) => axios.get(`/api/v4/search?scope=projects&search=${name}`)
	.then((response) => {
		const data = _.get(response, 'data');
		if (_.isEmpty(data)) return {};

		return _.first(_.filter(data, project => project.name === name));
	})
	.catch((error) => console.log(error));

const getDiscussionsByMergeRequest = (projectId, mergeRequestIid) => axios({
	url: `/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`,
}).then((response) => {
	const data = _.get(response, 'data');
	
	return _.isEmpty(data) ? [] : data;
}).catch((error) => console.log(error));

const getMergeIdsByUserReactionEmoji = (projectId = null) => axios({
	url: projectId
		? `/api/v4/projects/${projectId}/merge_requests?my_reaction_emoji=Any`
		: '/api/v4/merge_requests?my_reaction_emoji=Any',
}).then((response) => {
	const data = _.get(response, 'data').filter((item) => item.state === 'opened').map((item) => item.iid);
	
	return _.isEmpty(data) ? [] : data;
}).catch((error) => console.log(error));

const setDiscussionInfo = async (mergeRequest) => {
	const discussions = await getDiscussionsByMergeRequest(mergeRequest.projectId, mergeRequest.id);
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

		if (!carry.hasOwnProperty(name) || new Date(carry[name].created_at) < new Date(item.created_at)) {
			carry[name] = item;
		}

		return carry;
	}, {});

	mergeRequest.awaitDiscussionsList = Object.values(uniqDiscussions);
	mergeRequest.hasOpenedDiscussions = mergeRequest.awaitDiscussionsList.length > 0;

	return mergeRequest;
};

const getTime = (element) => Date.parse(element.find('time').attr('datetime'));

const hasToTestLabel = (element) => element
	.find('.gl-label-text')
	.filter((index, elem) => toTestLabels.includes(elem.innerText.trim()))
	.length > 0;

const hasTestDoneLabel = (element) => element
	.find('.badge')
	.filter((index, elem) => testDoneLabels.includes(elem.innerText.trim()))
	.length > 0;

const hasMergeConflictsMark = (element) => element.find('.issuable-pipeline-broken').length > 0;
const getLikes = (element) => parseInt(element.find('.issuable-upvotes').text(), 0) || 0;
const isWip = (mergeRow) => mergeRow.find('.merge-request-title-text a').text().includes('WIP');
const isMergeRequestPage = () => $('.merge-request-tabs').length > 0;
const getIssuableReference = (mergeRow) => mergeRow.find('.issuable-reference').text().replace(/\D/g, '');
const getMergeRequestTitleTextElement = (mergeRow) => mergeRow.find('.merge-request-title-text');
const getMergeDescription = (mergeRow) => mergeRow.find('.issuable-info');

const getCurrentProjectName = () => {
	const locationPath = window.location.pathname.split('/');
	if (locationPath.length < 2) {
		return null;
	}

	return locationPath[2];
};

// -/////////////////////////////////////////////////////////////////////////////////////////////////////

const highlightWhichIsReady = (mergeRequest) => {
	if (!mergeRequest.isReady()) return;

	mergeRequest.element.css({
		backgroundColor: 'rgb(223, 245, 212)',
		borderLeft: '5px solid rgb(19, 144, 16)',
	});
	mergeRequest.element.removeAttr('title');
};

const highlightPipelines = (mergeRequest) => {
	if (mergeRequest.isWip) return;

	const isPipelineSuccess = mergeRequest.element.find('.ci-status-icon-success').length > 0;
	const isPipelineRunning = mergeRequest.element.find('.ci-status-icon-running').length > 0;

	if (isPipelineSuccess || isPipelineRunning) return;

	const isPipelineFailed = mergeRequest.element.find('.ci-status-icon-success-with-warnings').length > 0;

	if (isPipelineFailed) {
		mergeRequest.element.css({
			borderRight: '3px dotted #fc9403',
		});

		return;
	}

	mergeRequest.element.css({
		borderRight: '3px dotted rgb(207, 207, 207)',
	});
};

const highlightWhichIsAlmostReady = (mergeRequest) => {
	if (!mergeRequest.isAlmostReady()) return;

	mergeRequest.element.css({
		backgroundColor: '#fdf9f0',
		borderLeft: '5px solid #ff9c00',
	});
	mergeRequest.element.attr('title', 'Only 1 like to go');
};

const highlightWhichIsOld = (mergeRequest) => {
	if (mergeRequest.isReady()) return;
	if (mergeRequest.isAlmostReady()) return;
	if (mergeRequest.hasMergeConflictsMark) return;

	const twoWeeks = (20166) * 60 * 1000;
	const nowTime = (new Date()).getTime();

	if ((nowTime - mergeRequest.time) > twoWeeks) {
		mergeRequest.element.css({
			backgroundColor: 'rgb(234, 234, 234)',
			borderLeft: '5px solid rgb(104, 104, 104)',
		});
		mergeRequest.element.attr('title', 'Is pretty old');
	}
};

const highlightWhichIsConflicts = (mergeRequest) => {
	if (!mergeRequest.hasMergeConflictsMark) return;

	mergeRequest.element.css({
		backgroundColor: 'rgb(255, 245, 245)',
		borderLeft: '5px solid rgb(217, 83, 79)',
	});
	mergeRequest.element.attr('title', 'Has some problems');
};

const highlightWIP = (mergeRequest) => {
	if (!mergeRequest.isWip) return;

	mergeRequest.element.css({
		opacity: '0.5',
	});
};

const highlightWhichIsLiked = (mergeRequest) => {
	if (mergeRequest.liked) {
		mergeRequest.element.find('.issuable-upvotes').css('color', 'rgb(16, 113, 14)');
	}
};

const highlightWhichIsDiscussed = (mergeRequest) => {
	if (mergeRequest.awaitDiscussionsList.length > 0) {
		mergeRequest.element.find('.issuable-comments i').css('color', '#D9534F');
		mergeRequest.element.css({
			backgroundColor: '#fff',
			borderLeft: '0',
		});
	}
};

/**
 * @param {Array<object>} mergeRequests
 * @param {string} match
 */
const filterWithClassMatch = (mergeRequests, match) => {
	mergeRequests.forEach(mr => {
		const hasClass = mr.element.find(match).length > 0;

		if (hasClass) {
			mr.element.show();
		}
		else {
			mr.element.hide();
		}
	});
};

/**
 * @param {Array<object>} mergeRequests
 */
const filterReady = (mergeRequests) => {
	mergeRequests.forEach(mr => {
		const isPipelineSuccess = mr.element.find('.ci-status-icon-success').length > 0;
		const isReady = isPipelineSuccess
			&& mr.likes >= 2
			&& !mr.isWip
			&& !mr.hasMergeConflictsMark
			&& !mr.hasOpenedDiscussions
			&& !mr.hasToTestLabel;

		if (isReady) {
			mr.element.show();
		}
		else {
			mr.element.hide();
		}
	});
};

// -/////////////////////////////////////////////////////////////////////////////////////////////////////

const buildMergeRequest = (projectId = null, user = null, mergeRow, likedMergeRequestIds = []) => {
	const mergeRequestIid = getIssuableReference(mergeRow);
	const likedByMe = likedMergeRequestIds.indexOf(parseInt(mergeRequestIid)) !== -1;
	const comments = parseInt(mergeRow.find('.issuable-comments a').text().replaceAll(/(\D)+/g, ''), 0);

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

		isReady: function isReady() {
			if (!this.hasPassedTesting()) return false;
			if (this.likes < 2 || this.isWip) return false;
			if (this.hasMergeConflictsMark) return false;
			return true;
		},
		isAlmostReady: function isAlmostReady() {
			if (this.hasMergeConflictsMark) return false;
			if (!this.hasPassedTesting()) return false;
			if (this.likes < 1 || this.isWip) return false;
			return true;
		},
		hasPassedTesting: function hasPassedTesting() {
			if (!this.hasToTestLabel) return true;
			return this.hasTestDoneLabel;
		}
	};
	if (!projectId) return mergeRequest;
	if (comments === 0) return mergeRequest;

	return setDiscussionInfo(mergeRequest).catch(() => mergeRequest);
};

const processMergeRequest = (mergeRequest) => {
	mergeRequest.element.css({
		backgroundColor: '#fff',
		borderLeft: '5px solid #fff',
	});
	const mergeRequestTitleTextElement = getMergeRequestTitleTextElement(mergeRequest.element);
	const mergeRequestDescElement = getMergeDescription(mergeRequest.element);
	const currentNameMergeRequest = mergeRequestTitleTextElement.html();
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
			return `
			<div>
				<a class="author-link has-tooltip" data-container="body" href="${userLink}">
					<img class="avatar avatar-inline s16 js-lazy-loaded qa-js-lazy-loaded" alt="${name}'s avatar" src="${avatar}" loading="lazy" width="16">
				</a>
				<a class="author-link js-user-link  " data-user-id="78" data-username="${username}" data-name="${name}" href="${userLink}" title=""><span class="author">${name}</span></a>
				<time class="js-timeago" title="${time}" datetime="${time}" data-toggle="tooltip" data-placement="bottom" data-container="body" data-original-title="${time}"></time>
			</div>
            `;
		};

		mrTitle.push(badgeUnresolvedDiscussions);

		const discussionsPanel = $(document.createElement('div')).addClass('issuable-info small');

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
	mergeRequestTitleTextElement.html(mrTitle.join(' '));

	highlightWhichIsAlmostReady(mergeRequest);
	highlightWhichIsOld(mergeRequest);
	highlightWhichIsConflicts(mergeRequest);
	highlightWIP(mergeRequest);
	highlightWhichIsReady(mergeRequest);
	highlightWhichIsLiked(mergeRequest);
	highlightWhichIsDiscussed(mergeRequest);
	highlightPipelines(mergeRequest);
};

const processMergeRequests = (projectId = null, user = null, likedMergeRequestIds = []) => {
	$('.merge-request').each(async (index, element) => {
		const mergeRow = $(element);
		const mr = await buildMergeRequest(projectId, user, mergeRow, likedMergeRequestIds);

		mergeRow.data('merge-id', mr.id);
		map[mr.id] = mr;

		processMergeRequest(mr);
	});
};

const getLikesCount = () => {
	return $('[data-name="thumbsup"]').next().html();
};

const mergeRequestLogic = () => {
	if (getLikesCount() < upVotesForCanBeMerged) {
		$('.accept-merge-request')
			.removeClass('btn-warning')
			.addClass('btn-warning')
			.attr('title', `Likes sess than ${upVotesForCanBeMerged}`);
	}
};
const createButton = (name, url) => {
	return $(document.createElement('a'))
		.text(name)
		.attr('href', url)
		.addClass('btn btn-default btn-sm');
};

$(document).ready(function() {
	if (isMergeRequestPage()) {
		mergeRequestLogic();
		
		return;
	}

	const currentProject = getCurrentProjectName();
	if (!currentProject) return;

	const author = $('.current-user').text().trim().match(/@.+/gm)[0].replace('@', '');
	const btns = [
		createButton('My MRs', '?scope=all&utf8=✓&state=opened&author_username=' + author),
		createButton('To review', '?scope=all&utf8=✓&state=opened&not[my_reaction_emoji]=thumbsup&wip=no&target_branch=master&not[author_username]=' + author),
		createButton('Assignee', '?scope=all&utf8=✓&state=opened&assignee_username=' + author),
		createButton('To test', '?scope=all&utf8=✓&state=opened&label_name[]=To test'),
		createButton('Not master', '?scope=all&utf8=✓&state=opened&not[target_branch]=master'),
		createButton('No WIP', '?scope=all&utf8=✓&state=opened&wip=no'),
		createButton('Tested', '?scope=all&utf8=✓&state=opened&label_name[]=Tested'),
		createButton('Liked', '?scope=all&utf8=✓&state=opened&my_reaction_emoji=thumbsup'),
	];

	const $customPanel = $(document.createElement('div'));

	btns.forEach((btn) => $customPanel.append($(document.createElement('span')).addClass('pr-1').append(btn)));

	$('.issues-filters').after(`
		<div class="customer-panel pt-3 pb-3">
			<div class="row">
				<div class="custom-panel__buttons col-7"></div>
				<div class="col-5 text-right">
					<button data-match=".title" class="js-filter btn btn-default btn-sm has-tooltip" title="" data-placement="left" href="#" data-original-title="All">
						All
					</button>
					<button data-match=".ci-status-icon-skipped" class="js-filter btn btn-default btn-sm ci-status-icon-skipped has-tooltip" title="" data-placement="left" href="#" data-original-title="Pipeline: skipped">
						<svg class="s16"><use xlink:href="/assets/icons-730bc9dd942fde159bc545aaf03f0f828f24a8a4cf2cf3c95c9d5b3042a98e0d.svg#status_skipped"></use></svg>
					</button>
					<button data-match=".ci-status-icon-success-with-warnings" class="js-filter  btn btn-default btn-sm ci-status-icon-success-with-warnings has-tooltip" title="" data-placement="left" href="#" data-original-title="Pipeline: passed with warnings">
						<svg class="s16"><use xlink:href="/assets/icons-730bc9dd942fde159bc545aaf03f0f828f24a8a4cf2cf3c95c9d5b3042a98e0d.svg#status_warning"></use></svg>
					</button>
					<button data-match=".ci-status-icon-success" class="js-filter btn btn-default btn-sm ci-status-icon-success has-tooltip" title="" data-placement="left" href="#" data-original-title="Pipeline: success">
						<svg class="s16"><use xlink:href="/assets/icons-730bc9dd942fde159bc545aaf03f0f828f24a8a4cf2cf3c95c9d5b3042a98e0d.svg#status_success"></use></svg>
					</button>
					<button data-match=".ci-status-icon-running" class="js-filter btn btn-default btn-sm ci-status-icon-running has-tooltip" title="" data-placement="left" href="#" data-original-title="Pipeline: running">
						<svg class="s16"><use xlink:href="/assets/icons-730bc9dd942fde159bc545aaf03f0f828f24a8a4cf2cf3c95c9d5b3042a98e0d.svg#status_running"></use></svg>
					</button>
					<button data-match=".ci-status-icon-failed" class="js-filter btn btn-default btn-sm ci-status-icon-failed has-tooltip" title="" data-placement="left" href="#" data-original-title="Pipeline: failed">
						<svg class="s16"><use xlink:href="/assets/icons-730bc9dd942fde159bc545aaf03f0f828f24a8a4cf2cf3c95c9d5b3042a98e0d.svg#status_failed"></use></svg>
					</button>
					<button data-match=".badge" class="js-filter btn btn-default has-tooltip" title="" data-placement="left" href="#" data-original-title="With discussions">
						<span class="badge color-label has-tooltip" style="background-color: #D9534F; color: #FFFFFF" title="" data-container="body" data-original-title="Merge-request has unresolved discussions">UD</span>
					</button>
					<button data-find="ready" class="js-filter btn btn-default btn-sm ci-status-icon-failed has-tooltip" title="" data-placement="left" href="#" data-original-title="Ready to release">
						Ready
					</button>
				</div>
			</div>
		</div>
	`);

	$('.custom-panel__buttons').append($customPanel);
	const $jsFilterBtn = $('.js-filter');
	$jsFilterBtn.attr('disabled', 'disabled');

	getMe().then((user) => {
		getProjectByName(currentProject).then(async (project) => {
			const projectId = _.get(project, 'id') || null;
			const likedMergeRequestIds = await getMergeIdsByUserReactionEmoji(projectId);

			processMergeRequests(projectId, user, likedMergeRequestIds);
			setTimeout(() => {
				timeago.render(document.querySelectorAll('.js-timeago'));
			}, 3000);
		}).catch(() => processMergeRequests());
	}).catch((error) => console.log(error));

	$jsFilterBtn.removeAttr('disabled');

	$(document).on('click', '.js-filter', (element) => {
		const button = $(element.currentTarget);
		const match = button.data('match');
		const find = button.data('find');

		$jsFilterBtn.removeClass('active');
		button.addClass('active');
		if (match) {
			filterWithClassMatch(Object.values(map), match);

			return;
		}

		if (find && find === 'ready') {
			filterReady(Object.values(map));
		}
	});
});
