export const LAST_LOCATION_STORAGE_KEY = "mori-last-location";

const isRecord = (value) => value && typeof value === "object";

export const readLastLocation = (storage) => {
  if (!storage?.getItem) return null;
  try {
    const value = JSON.parse(storage.getItem(LAST_LOCATION_STORAGE_KEY));
    if (!isRecord(value)) return null;
    return {
      projectId: typeof value.projectId === "string" ? value.projectId : "",
      noteId: typeof value.noteId === "string" ? value.noteId : "",
    };
  } catch {
    return null;
  }
};

export const saveLastLocation = (storage, location) => {
  if (!storage?.setItem || !isRecord(location)) return;
  try {
    storage.setItem(
      LAST_LOCATION_STORAGE_KEY,
      JSON.stringify({
        projectId: String(location.projectId || ""),
        noteId: String(location.noteId || ""),
      }),
    );
  } catch {
    // Storage can be unavailable in private or restricted renderer contexts.
  }
};

export const resolveLastLocation = (data, savedLocation) => {
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  const notes = Array.isArray(data?.notes)
    ? data.notes.filter((note) => note && !note.trashed)
    : [];
  const project =
    projects.find((item) => item?.id === savedLocation?.projectId) ||
    projects[0];
  const savedNote = notes.find((item) => item.id === savedLocation?.noteId);
  const note =
    (savedNote && (!project || savedNote.projectId === project.id) && savedNote) ||
    notes.find((item) => item.projectId === project?.id) ||
    notes[0];

  return {
    projectId: note?.projectId || project?.id || "",
    noteId: note?.id || "",
  };
};
