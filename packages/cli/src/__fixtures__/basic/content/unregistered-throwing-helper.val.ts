// Throws while being imported, so anything that inspects it - or a file that
// imports it - has to survive a half-built module cache entry.
throw Error("helper boom");
