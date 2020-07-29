#!/usr/bin/env node
import * as inquirer from 'inquirer';
import * as chalk from 'chalk';

import { addRemote, applyUpdate, Commit, getUpdates, removeRemote, getDate } from './git';

(async function main(remoteUrl?: string, ignoreAllSpace?: boolean): Promise<number> {
	const remoteName = "upstream-template";
	if (!remoteUrl) {
		console.error("Please provide an upstream-url");
		return 1;
	}
	await removeRemote(remoteName);
	if (await addRemote(remoteName, remoteUrl)) {
		const updates = await getUpdates(`${remoteName}/master`);
		if (updates.length) {
			// console.log(chalk.default.yellow(`Nr of revisions to merge: ` + chalk.default.bold(updates.length.toString()))); 
			
/* 			const { selection } = await inquirer.prompt<{ selection: Commit[] }>({
				choices: [
					new inquirer.Separator(),
					...updates.map(commit => ({
						name: commit.message,
						value: commit
					}))
				],
				name: "selection",
				type: "checkbox",
				pageSize: 25
			});
 */
			const updateSet = updates.sort((commitA, commitB) => commitA.timestamp - commitB.timestamp);
			console.log(chalk.default.bgCyan(`(from oldest to newest) List of revisions to merge (` + chalk.default.bold(updates.length.toString())+ `)`));
			for (const update of updateSet) {
				let d = getDate(update.timestamp);
				console.log(chalk.default.magenta(d.toLocaleDateString() + " # " + update.message));
			}
			
			for (const update of updateSet) {
				await applyUpdate(update, !ignoreAllSpace ? false : true);
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
