import * as chalk from 'chalk';
import { spawn, execSync } from 'child_process';
import * as inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';

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

export async function applyUpdate(commit: Commit, ignoreAllSpaces: boolean, renameThreshold: number) {
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
		const command = `cherry-pick ${renameThreshold == -1 ? `` : `-X find-renames=${renameThreshold}%`} ${!ignoreAllSpaces ? `` : `-X ignore-all-space`} ${commit.hash} --no-commit`;
		console.log(chalk.default.green` Running cherry-pick command: ` + command);
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

export async function runUpdateRepo() {
	let domainId = '', serviceId = '';

	const getFirstDir = (dir: string, regex: RegExp) => {
		const files = fs.readdirSync(dir);
		// console.log(`Dirs to process: ${files}`)
		for (let i = 0; i < files.length; i++) {
			let file = path.join(dir, files[i]);
			if (fs.statSync(file).isDirectory()) {
				// console.log(`file is dir: ${file}`);
				const groups = regex.exec(file);
				// console.log(`groups: ${groups}`);
				if (groups) {
					// console.log(`groups: ${groups}`);
					domainId = groups ? groups[1] : '';
					serviceId = groups ? groups[2] : '';
					// console.log(`adding file to result: `, file);
					// reset regexp expression
					regex.lastIndex = 0;
					break;
				}

			}
		}
	}

	const match = RegExp("SBC\.([^\.]+)\.([^\.]+)\.(.*)", 'g');

	const dir = "./src";
	getFirstDir(dir, match);
	console.log(`domaindId: ${domainId}`);
	console.log(`serviceId: ${serviceId}`);
	if(fs.existsSync("update_repo.sh")) {
		// update_repo.sh exists, so go for variables replacement
		const cmd = `sh update_repo.sh --stage repo-update --domainId ${domainId} --serviceId ${serviceId}`;
		console.log(chalk.default.cyanBright(`Executing update repo task with command: ${cmd}`));
		const updaterepo = execSync(cmd, { stdio: 'inherit' });	
	} else {
		console.log(chalk.default.cyanBright(`>> update_repo.sh does not exist. Variable replacement process not executed.`));
	}
    console.log(chalk.default.cyanBright(`### Update Base Template process finished ###`));
}