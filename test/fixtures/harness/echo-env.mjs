// Dumps the environment the harness handed to the child, so the passthrough
// guard can assert the canary is absent.
console.log(JSON.stringify(process.env));
