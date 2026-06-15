// Canonical fake users matching the shape /api/current-user returns.
export const USERS = {
  faculty: {
    _id: "user-faculty",
    id: "user-faculty",
    username: "facultycwl",
    displayName: "Dr. Ada Faculty",
    email: "ada.faculty@ubc.ca",
    role: "faculty",
    isFaculty: true,
    isStaff: false,
    isStudent: false,
  },
  staff: {
    _id: "user-staff",
    id: "user-staff",
    username: "staffcwl",
    displayName: "Sam Staff",
    email: "sam.staff@ubc.ca",
    role: "staff",
    isFaculty: false,
    isStaff: true,
    isStudent: false,
  },
  student: {
    _id: "user-student",
    id: "user-student",
    username: "studentcwl",
    displayName: "Riley Student",
    email: "riley.student@ubc.ca",
    role: "student",
    isFaculty: false,
    isStaff: false,
    isStudent: true,
  },
};

// A course as returned by /api/courses/my (rich profile fields) and the
// trimmed { id, name } shape persisted to sessionStorage by the app.
export const COURSE = {
  _id: "course-1",
  id: "course-1",
  name: "CHEM 121",
  courseName: "CHEM 121",
  instructorName: "Dr. Ada Faculty",
  semester: "Fall 2025",
  expectedStudents: 120,
  published: true,
};

export const SELECTED_COURSE = { id: COURSE._id, name: COURSE.name };
