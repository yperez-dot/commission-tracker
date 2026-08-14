/** Stash a File briefly when switching upload destinations. */

let pending = null;

export function setPendingUpload(file) {
  pending = file || null;
}

export function takePendingUpload() {
  const f = pending;
  pending = null;
  return f;
}
