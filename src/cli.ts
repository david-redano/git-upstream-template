#!/usr/bin/env node
import * as chalk from 'chalk';
// import * as pack from '../package.json';

import { runUpdateRepo, addRemote, applyUpdate, getUpdates, removeRemote, getDate, git } from './git';
import { rename } from 'fs';

(async function main(remoteUrl?: string, renameThreshold?: number, ignoreAllSpace?: boolean): Promise<number> {
	const remoteName = "upstream-template";
	if (!remoteUrl) {
		console.error("Please provide an upstream-url");
		return 1;
	}
	// const version = pack.version;
	// console.log(chalk.default.whiteBright(`Version: ${version}`));
	console.log(chalk.default.whiteBright(`ignoreAllSpace: ${ignoreAllSpace ? `${ignoreAllSpace} (user)` : `false (default)`}`));
	console.log(chalk.default.whiteBright(`renameThreshold: ${renameThreshold ?`${renameThreshold}% (user)` : `50% (default)`}`));
	await removeRemote(remoteName);
	if (await addRemote(remoteName, remoteUrl)) {
		console.log(`Getting updates from remote: ${remoteUrl}`);
		const updates = await getUpdates(`${remoteName}/release`);
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
				await applyUpdate(update, ignoreAllSpace ? ignoreAllSpace : false, renameThreshold ? renameThreshold : -1);
			}
			if (stashed) {
				await git(`stash pop`, { verbose: true });
			}
			console.log(`### Synchronizing changes from Template Process finished ###`);
			await runUpdateRepo();
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
