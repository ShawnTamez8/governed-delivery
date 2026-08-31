// A verification command that fails. The marker goes to stderr, so a test
// that finds it there has proved the streams are kept apart.
console.error("VERIFY_FAILED");
process.exit(2);
