// JXA helper: moves files to the macOS Trash via NSFileManager.
// Reads a JSON array of paths from the file given as argv[0],
// prints a JSON array of { path, ok, error? } to stdout.
ObjC.import("Foundation");

function readJSON(path) {
  const contents = $.NSString.stringWithContentsOfFileEncodingError(
    path,
    $.NSUTF8StringEncoding,
    null,
  );
  return JSON.parse(ObjC.unwrap(contents));
}

function run(argv) {
  const paths = readJSON(argv[0]);
  const fm = $.NSFileManager.defaultManager;

  const results = paths.map(function (p) {
    try {
      const url = $.NSURL.fileURLWithPath(p);
      const error = $();
      const ok = fm.trashItemAtURLResultingItemURLError(url, null, error);
      if (ok === true) return { path: p, ok: true };
      let message = "Could not move to Trash.";
      try {
        message = ObjC.unwrap(error.localizedDescription) || message;
      } catch (e) {
        /* keep generic message */
      }
      return { path: p, ok: false, error: message };
    } catch (e) {
      return { path: p, ok: false, error: String(e) };
    }
  });

  return JSON.stringify(results);
}
