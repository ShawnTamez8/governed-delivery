// The environment canary. Whatever this prints is what implementer-authored
// code could read, so a test asserts in both directions: an unlisted variable
// set in the parent must be absent, and a listed one must be present.
console.log(JSON.stringify(process.env));
