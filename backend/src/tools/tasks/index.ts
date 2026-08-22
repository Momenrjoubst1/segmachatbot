// Task Management Tools
//
// The assistant has full CRUD control over the user's task list:
// - create_task: add a task/todo
// - update_task: edit title/details/due date/priority
// - complete_task: mark done (or reopen)
// - delete_task: remove permanently
// - get_tasks: list/filter tasks

// Auto-register tools on import
import "./create-task.js";
import "./update-task.js";
import "./complete-task.js";
import "./delete-task.js";
import "./get-tasks.js";
