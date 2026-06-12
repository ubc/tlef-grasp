import { create } from "zustand";

// Storage keys kept identical to the legacy app so existing sessions carry over.
const COURSE_KEY = "grasp-selected-course";
const ROLE_KEY = "grasp-current-role";

function readSelectedCourse() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(COURSE_KEY) || "{}");
    return stored && stored.id ? stored : null;
  } catch {
    return null;
  }
}

export const useAppStore = create((set) => ({
  // Selected course: { id, name } — persisted in sessionStorage (per-tab, like legacy)
  selectedCourse: readSelectedCourse(),
  setSelectedCourse: (course) => {
    if (course && course.id) {
      sessionStorage.setItem(
        COURSE_KEY,
        JSON.stringify({ id: course.id, name: course.name })
      );
      set({ selectedCourse: { id: course.id, name: course.name } });
    } else {
      sessionStorage.removeItem(COURSE_KEY);
      set({ selectedCourse: null });
    }
  },

  // View role for faculty/staff: "instructor" | "student" — persisted in localStorage
  currentRole: localStorage.getItem(ROLE_KEY) || "instructor",
  setCurrentRole: (role) => {
    localStorage.setItem(ROLE_KEY, role);
    set({ currentRole: role });
  },
}));
