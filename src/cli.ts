#!/usr/bin/env node
import * as inquirer from 'inquirer';
import * as chalk from 'chalk';

import { addRemote, applyUpdate, Commit, getUpdates, removeRemote, getDate, git } from './git';

(async function main(remoteUrl?: string, ignoreAllSpace?: boolean): Promise<number> {
	const remoteName = "upstream-template";
	if (!remoteUrl) {
		console.error("Please provide an upstream-url");
		return 1;
	}
	await removeRemote(remoteName);
	if (await addRemote(remoteName, remoteUrl)) {
		console.log(`Unable to add remote repository with url: ${remoteUrl}`);
		const updates = await getUpdates(`${remoteName}/release`);
		// console.log(`updates:  ${updates}`);
		if (updates.length) {
			const updateSet = updates.sort((commitA, commitB) => commitA.timestamp - commitB.timestamp);
			console.log(chalk.default.bgCyan(`List of revisions to merge (` + chalk.default.bold(updates.length.toString()) + `)`));
			for (const update of updateSet) {
				let d = getDate(update.timestamp);
				console.log(chalk.default.blueBright("[" + d.toLocaleDateString() + "] " + update.hash + ": " + update.message));
			}
			console.log(chalk.default.yellow`Stashing your current working directory before applying updates...`);
			const stashed = !(await git(`stash save Before applying upstream-template updates`, {
				verbose: true
			})).includes("No local changes");
			for (const update of updateSet) {
				await applyUpdate(update, !ignoreAllSpace ? false : true);
			}
			if (stashed) {
				await git(`stash pop`, { verbose: true });
			}
			console.log(`### Template Update Process finished ###`);
		} else {
			console.log(`There are no new updates from upstream template repository`);
		}
	} else {
		console.log(`Unable to add remote repository with url: ${remoteUrl}`);
		await removeRemote(remoteName);
		return 1;
	}
	await removeRemote(remoteName);
	return 0;
})(...process.argv.slice(2))
	.then(process.exit)
	.catch(console.error);
