// Writes to stdout continuously and never exits — a suite stuck in a logging
// loop. Unlike flood-stdout.mjs it has no end, so it is what proves the
// retention ceiling bounds the evidence file: without one, the only bound is
// the command's time ceiling, and this fixture writes about a gigabyte a
// second.
const line = "x".repeat(64 * 1024);
function pump() {
  while (process.stdout.write(line)) {
    /* keep writing until the pipe applies backpressure */
  }
  process.stdout.once("drain", pump);
}
pump();
