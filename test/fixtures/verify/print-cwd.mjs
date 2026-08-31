// Proves the command ran in the run's worktree and not in the repository
// root: a suite run in the wrong tree verifies the wrong bytes.
console.log(process.cwd());
