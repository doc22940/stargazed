/**
 *  @author abhijithvijayan <abhijithvijayan.in>
 */

const ejs = require('ejs');
const path = require('path');
const ghGot = require('gh-got');
const unescape = require('lodash.unescape');

const Spinner = require('./utils/spinner');
const { flashError } = require('./utils/message');
const validateArguments = require('./utils/validate');
const { handleRepositoryActions, setUpWorkflow } = require('./utils/repo');
const { readFileAsync, writeFileAsync } = require('./utils/fs');

// User-input argument options
const options = {};

/**
 *  Escape symbol table
 */
const htmlEscapeTable = {
	'>': '&gt;',
	'<': '&lt;',
	'\n': '',
	'[|]': '\\|',
};

/**
 *  Replace special characters with escape code
 */
String.prototype.htmlEscape = function() {
	let escStr = this;

	Object.entries(htmlEscapeTable).map(([key, value]) => {
		return (escStr = escStr.replace(new RegExp(key, 'g'), value));
	});

	return escStr;
};

/**
 *  Read the template from markdown file
 */
const getReadmeTemplate = async () => {
	const spinner = new Spinner('Loading README template');
	spinner.start();

	try {
		const template = await readFileAsync(path.resolve(__dirname, 'templates', './stargazed.md'), 'utf8');

		spinner.succeed('README template loaded');

		return template;
	} catch (err) {
		spinner.fail('README template loading failed!');
		flashError(err);
	} finally {
		spinner.stop();
	}
};

/**
 *  Render out readme content
 */
const buildReadmeContent = async context => {
	const template = await getReadmeTemplate();

	return ejs.render(template, {
		...context,
	});
};

/**
 *  Write content to README.md
 */
const writeReadmeContent = async readmeContent => {
	const spinner = new Spinner('Creating README locally');
	spinner.start();

	try {
		await writeFileAsync('README.md', unescape(readmeContent));

		spinner.succeed('README created locally');
	} catch (err) {
		spinner.fail('Failed to create README');
		flashError(err);
	} finally {
		spinner.stop();
	}
};

/**
 *  Asynchronous API Call
 */
const fetchUserStargazedRepos = async ({ spinner, list = [], page = 1 }) => {
	const { username, token } = options;
	let pageNumber = page;
	let entries = list;
	let response;

	const url = `users/${username}/starred?&per_page=100&page=${pageNumber}`;

	try {
		response = await ghGot(url, { token });
	} catch (err) {
		spinner.fail('Error occured while fetching data!');
		flashError(err);

		return;
	}

	const { body, headers } = response;

	// Concatenate to existing data
	entries = entries.concat(body);

	// GitHub returns `last` for the last page
	if (headers.link && headers.link.includes('next')) {
		pageNumber += 1;
		return fetchUserStargazedRepos({ spinner, list: entries, page: pageNumber });
	}

	return { list: entries };
};

/**
 *  stargazed repo list parser
 */
const parseStargazedList = ({ list, unordered }) => {
	return list.forEach(item => {
		let {
			name,
			description,
			html_url,
			language,
			stargazers_count,
			owner: { login },
		} = item;

		language = language || 'Others';
		description = description ? description.htmlEscape() : '';

		if (!(language in unordered)) {
			unordered[language] = [];
		}

		unordered[language].push([name, html_url, description.trim(), login, stargazers_count]);
	});
};

/**
 *  Core Driver function
 */
const stargazed = async _options => {
	const err = validateArguments(_options);

	if (err) {
		flashError(err);
		return;
	}

	const { username, token = '', sort, repo, workflow } = options;

	let gitStatus = false;
	let cronJob = false;

	if (!username) {
		flashError('Error! username is a required field.');
		return;
	}

	if (repo) {
		if (!token) {
			flashError('Error: creating repository needs token. Set --token');
			return;
		}
		if (workflow) {
			cronJob = true;
		}
		gitStatus = true;
	}

	/**
	 *  Trim whitespaces
	 */
	if (typeof String.prototype.trim === 'undefined') {
		String.prototype.trim = function() {
			return String(this).replace(/^\s+|\s+$/g, '');
		};
	}

	const unordered = {};
	const ordered = {};

	const spinner = new Spinner('Fetching stargazed repositories...');
	spinner.start();

	// API Calling function
	const { list = [] } = await fetchUserStargazedRepos({ spinner });

	spinner.succeed(`Fetched ${Object.keys(list).length} stargazed items`);
	spinner.stop();

	/**
	 *  Parse and save object
	 */
	if (Array.isArray(list)) {
		await parseStargazedList({ list, unordered });
	}

	/**
	 *  Sort to Languages alphabetically
	 */
	if (sort) {
		Object.keys(unordered)
			.sort()
			.forEach(function(key) {
				ordered[key] = unordered[key];
			});
	}

	/**
	 *  Generate Language Index
	 */
	const languages = Object.keys(sort ? ordered : unordered);

	const readmeContent = await buildReadmeContent({
		// array of languages
		languages,
		// Total items count
		count: Object.keys(list).length,
		// Stargazed Repos
		stargazed: sort ? ordered : unordered,
		username,
		date: `${new Date().getDate()}--${new Date().getMonth() + 1}--${new Date().getFullYear()}`,
	});

	/**
	 *  Write Readme Content locally
	 */
	await writeReadmeContent(readmeContent);

	/**
	 *  Handles all the repo actions
	 */
	if (gitStatus) {
		await handleRepositoryActions({ readmeContent: unescape(readmeContent) });
	}

	/**
	 *  Setup GitHub Actions for Daily AutoUpdate
	 */
	if (cronJob) {
		await setUpWorkflow();
	}
};

// The user input options object
module.exports.options = options;
module.exports = stargazed;
module.exports.htmlEscapeTable = htmlEscapeTable;
module.exports.getReadmeTemplate = getReadmeTemplate;
module.exports.buildReadmeContent = buildReadmeContent;
module.exports.writeReadmeContent = writeReadmeContent;
