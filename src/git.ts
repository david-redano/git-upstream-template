import * as chalk from 'chalk';
import { spawn } from 'child_process';
import * as inquirer from 'inquirer';

const DEBUG = false;

export interface Commit {
	message: string;
	hash: string;
	timestamp: number;
}

export interface Update {
	package: string;
	version: string;
}

export function git(
	cmd: string,
	{ noPager, verbose }: { noPager?: boolean; verbose?: boolean } = { noPager: false, verbose: false }
) {
	const gitCmd = `git${(noPager && " --no-pager") || ""}`;
	return run(`${gitCmd} ${cmd}`, { verbose });
}

function run(inputCommand: string, { verbose }: { verbose?: boolean } = { verbose: false }): Promise<string> {
	let output = "";
	const [cmd, ...args] = (
		inputCommand.match(
			/[A-z0-9\-\_\:\/\\\.\@\!\#\$\%\^\&\*\(\)\{\}\[\]\;\<\>\=\+\~]+|"(?:[^\"]|(?<=\\)")+"|'(?:[^\']|(?<=\\)')+'/g
		) || []
	).map(arg => arg.replace(/^"|"$|\\(?="|')/g, ""));
	if (DEBUG) console.log(`» ${inputCommand}`, cmd, args);
	const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"] });

	if (verbose) {
		child.stdout.pipe(process.stdout);
		child.stderr.pipe(process.stderr);
	}
	child.stdout.on("data", chunk => {
		output += chunk;
	});
	child.stderr.on("data", chunk => {
		output += chunk;
	});

	return new Promise((res, rej) => {
		if (DEBUG) console.log(`« ${output}`);
		child.on("exit", code => {
			if (code) {
				rej(output);
			} else {
				res(output);
			}
		});
	});
}

export async function addRemote(remoteName: string, remoteUrl: string) {
	return successful(() => git(`remote add -f ${remoteName} ${remoteUrl}`));
}

export async function removeRemote(remoteName: string) {
	return successful(() => git(`remote remove ${remoteName}`));
}

export async function getCurrentBranchName() {
	const branchOutput = await git(`branch`);
	return (branchOutput.match(/\*\s(\S+)/) as any)[1];
}

export function getDate(unixtime: number): Date {
	return new Date(unixtime * 1000);
}

export async function getUpdates(updateBranch: string) {
	const currentBranch = await getCurrentBranchName();
	const currentHashes = (await git(`log ${currentBranch} --format=%h`)).trim().split("\n");
	const currentMessages = (await git(`log ${currentBranch} --format=%s`)).trim().split("\n");
	const currentDates = (await git(`log ${currentBranch} --format=%at`)).trim().split("\n");
	const templateHashes = (await git(`log ${updateBranch} --format=%h`)).trim().split("\n");
	const templateMessages = (await git(`log ${updateBranch} --format=%s`)).trim().split("\n");
	const templateDates = (await git(`log ${updateBranch} --format=%at`)).trim().split("\n");
	if (DEBUG) console.log(`currentBranch: ${currentBranch}`);
	const forkDate = +currentDates[currentDates.length - 1];
	if (DEBUG) console.log(`forkDate: ${forkDate}`);
	const afterFork = (commit: Commit) => commit.timestamp >= forkDate;
	const notApplied = (commit: Commit) =>
		currentMessages.findIndex(msg => msg.includes("🔄") && msg.includes(commit.hash)) === -1 &&
		currentHashes.findIndex(hash => hash === commit.hash) === -1
	// const notApplied = (commit: Commit) => {
	// 	const notExist = currentMessages.findIndex(msg => msg.includes("🔄") && msg.includes(commit.hash)) === -1 &&
	// 		currentHashes.findIndex(hash => hash === commit.hash) === -1;
	// 	if (DEBUG) console.log(`notExist: ${notExist}`);
	// 	const potentialRevert = currentMessages.findIndex(msg => msg.startsWith("Revert")) > -1;
	// 	if (DEBUG) console.log(`potentailRevert: ${potentialRevert}`);
	// 	let isRevert = false;
	// 	if(potentialRevert) {
	// 		const regularCommitIdx =  currentMessages.findIndex(msg => msg.includes("🔄") && msg.includes(commit.hash) && !msg.startsWith("Revert"))
	// 		const revertIdx = currentMessages.findIndex(msg => msg.startsWith("Revert"));
	// 		if (DEBUG) console.log(`hashIndex: ${regularCommitIdx}`);
	// 		if (DEBUG) console.log(`revertIndex: ${revertIdx}`);
	// 		const regularcommitDate = +currentDates[regularCommitIdx];
	// 		const revertDate = +currentDates[revertIdx];
	// 		if(revertDate > regularcommitDate) {
	// 			isRevert = true;
	// 		}

	// 	}

	// 	return (notExist || isRevert)
	// };

	if (DEBUG) console.log(`notApplied: ${notApplied}`);
	const updates = templateHashes
		.map((hash, idx) => ({ hash, message: templateMessages[idx], timestamp: +templateDates[idx] } as Commit))
		.filter(notApplied)
		.filter(afterFork);

	return updates;
}

export async function successful(fn: () => any) {
	try {
		await fn();
		return true;
	} catch {
		return false;
	}
}

export async function applyUpdate(commit: Commit, ignoreAllSpace: boolean) {
	const commitMessage = generateUpdateCommitMessage(commit);
	console.log(
		chalk.default.cyanBright(`Applying update for template commit: ` + chalk.default.bold(commit.message)));

	// console.log(chalk.default.yellow`Stashing your current working directory before applying updates...`);
	// const stashed = !(await git(`stash save Before applying upstream-template update ${commit.hash}`, {
	// 	verbose: true
	// })).includes("No local changes");

	// If it's an update commit, don't attempt to merge with git, use package manager instead...
	const update = extractUpdateCommit(commit);
	if (update) {
		await successful(() => run(`yarn upgrade ${update.package}@${update.version}`, { verbose: true }));
		await successful(() => git(`add -u`, { verbose: true }));
	} else {
		const command = `cherry-pick ${!ignoreAllSpace ? `` : `-X ignore-all-space`} ${commit.hash} --no-commit`;
		console.log(`${ignoreAllSpace ? `(ignoring spaces)` : ``}` + chalk.default.green` Running cherry-pick command: ` + command);
		await successful(() => git(command));
	}

	async function successfullyCommits() {
		try {
			if (DEBUG) console.log('> going to commit')
			await git(`commit -m "${commitMessage}"`, { verbose: true });
			if (DEBUG) console.log('successfully commited!')
			return true;
		} catch (stderr) {
			if (DEBUG) console.log(`Error committing:  ${stderr}`)
			if (stderr.includes("working tree clean")) {
				// the changes were already in the target getCurrentBranchName, so force a void commit
				const voidCommitCmd = `commit --allow-empty -m "${commitMessage}" `;
				await git(voidCommitCmd, { verbose: true });
			}
			return stderr.includes("working tree clean");
		}
	}
	while (!(await successfullyCommits())) {
		await inquirer.prompt({
			message: chalk.default.yellow`Resolve/stage conflicts and press any key to continue...`,
			name: "value"
		});
	}

	// if (stashed) {
	// 	await git(`stash pop`, { verbose: true });
	// }
}

function generateUpdateCommitMessage(commit: Commit) {
	return `🔄 ${commit.hash}: ${commit.message}`;
}

function extractUpdateCommit(commit: Commit): Update | false {
	const update = /Bump (\S+) from \S+ to (\S+)/g.exec(commit.message);
	if (update) {
		return {
			package: update[1],
			version: update[2]
		};
	} else {
		return false;
	}
}
