# 🚀 TaskFlow — Project & Task Management App

🔗 **Live Demo:** https://taskflow-sable-omega.vercel.app/

A modern, responsive task and project management web app built with **React**, **Vite**, **TypeScript**, and **Tailwind CSS**. Designed as a clean MVP for organizing tasks across projects with a beautiful dark-themed UI.

![React](https://img.shields.io/badge/React-19-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-7-purple?logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-blue?logo=tailwindcss)

---

## ✨ Features

- **📊 Dashboard** — Overview with stats cards, completion rate ring chart, recent tasks, and project progress bars
- **✅ Task Board** — Kanban-style columns (To Do → In Progress → Done) with search, priority filters, and project filters
- **📁 Projects** — Create and manage projects with color coding, task counts, and progress tracking
- **➕ Add Tasks** — Full-featured modal with title, description, priority picker, due date, and project assignment
- **💾 Persistent Storage** — All data automatically saves to `localStorage`
- **📱 Fully Responsive** — Collapsible sidebar with mobile hamburger menu
- **🎨 Dark Theme** — Polished dark UI with smooth transitions and hover effects

---

## 🎯 Purpose

TaskFlow was built as a portfolio-ready full-stack foundation to demonstrate:

- Component-driven architecture in React
- Type-safe development with TypeScript
- State management patterns
- Responsive UI design
- Future extensibility toward authentication and database-backed persistence

---

## 📂 Project Structure

```
taskflow/
├── public/
├── src/
│   ├── components/
│   │   ├── AddTaskModal.tsx    # Modal for creating new tasks
│   │   ├── Dashboard.tsx       # Dashboard view with stats & charts
│   │   ├── ProjectList.tsx     # Projects management view
│   │   ├── Sidebar.tsx         # Navigation sidebar
│   │   └── TaskBoard.tsx       # Kanban task board view
│   ├── hooks/
│   │   └── useStore.ts         # State management hook (localStorage)
│   ├── utils/
│   │   └── cn.ts               # Tailwind class merge utility
│   ├── types.ts                # TypeScript type definitions
│   ├── App.tsx                 # Main app component (entry point)
│   ├── main.tsx                # React DOM render
│   └── index.css               # Global styles & Tailwind imports
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| [React 19](https://react.dev) | UI framework |
| [TypeScript 5.9](https://typescriptlang.org) | Type safety |
| [Vite 7](https://vite.dev) | Build tool & dev server |
| [Tailwind CSS 4](https://tailwindcss.com) | Utility-first styling |
| [Lucide React](https://lucide.dev) | Icon library |
| [clsx](https://github.com/lukeed/clsx) + [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Class name utilities |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (v18 or higher recommended)
- npm (comes with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/ruichanglyu/taskflow.git
cd taskflow

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:5173`.

### Build for Production

```bash
npm run build
```

The production-ready files will be output to the `dist/` folder.

### Preview Production Build

```bash
npm run preview
```

---

## 🌐 Deployment

This is a **static site** — no backend server required. Deploy to any static hosting provider:

### Vercel (Recommended)
1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com) → **Import Project**
3. Select your repo — Vercel auto-detects Vite
4. Click **Deploy** ✅

### Netlify
1. Go to [netlify.com](https://netlify.com)
2. Drag & drop the `dist/` folder, or connect your GitHub repo
3. Set build command: `npm run build`, publish directory: `dist`

### GitHub Pages
1. Install the gh-pages package: `npm install -D gh-pages`
2. Add `base: '/your-repo-name/'` to `vite.config.ts`
3. Add deploy script to `package.json`: `"deploy": "gh-pages -d dist"`
4. Run `npm run build && npm run deploy`

---

## 📋 How to Use

1. **Dashboard** — See an overview of all your tasks and projects at a glance
2. **Tasks** — Click "New Task" to create tasks; assign priority, due dates, and projects
3. **Task Status** — Use the dropdown (⋮) on each task card to move between To Do → In Progress → Done
4. **Projects** — Create projects to organize related tasks; each project gets a unique color
5. **Filters** — Search tasks by name, filter by priority level, or filter by project
6. **Delete** — Remove tasks or projects using the dropdown menu or delete button

---

## 🗄️ Data Storage

Currently, all data is stored in the browser's **localStorage**. This means:

- ✅ Data persists across page refreshes
- ✅ No account or server needed
- ⚠️ Data is per-browser (not synced across devices)
- ⚠️ Clearing browser data will erase tasks

### Future: Supabase Integration

To enable multi-user support with cloud storage, you can integrate [Supabase](https://supabase.com):

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Set up `tasks` and `projects` tables with user ID foreign keys
3. Install the Supabase client: `npm install @supabase/supabase-js`
4. Replace the `useStore` localStorage logic with Supabase queries
5. Add authentication (email/password, Google, GitHub, etc.)

---

## 🧩 Key Components

### `useStore` Hook
The central state management hook that handles all CRUD operations for tasks and projects. All state changes are automatically persisted to localStorage.

**Available methods:**
- `addTask(title, description, status, priority, projectId, dueDate)` — Create a new task
- `updateTaskStatus(taskId, status)` — Move task between columns
- `deleteTask(taskId)` — Remove a task
- `addProject(name, description)` — Create a new project
- `deleteProject(projectId)` — Remove a project and unlink its tasks

### `TaskBoard` Component
Kanban-style board with three columns. Supports searching, filtering by priority, and filtering by project.

### `Dashboard` Component
Stats overview with task counts, completion percentage (animated ring chart), recent task list, and per-project progress bars.

---

## 🎨 Customization

### Colors
Project colors are randomly assigned from a curated palette defined in `useStore.ts`. You can modify the `PROJECT_COLORS` array to change the available colors.

### Seed Data
The app comes pre-loaded with 3 sample projects and 9 sample tasks. These are defined in `useStore.ts` as `seedProjects` and `seedTasks`. Clear your localStorage to reset to seed data, or modify the seed arrays to change defaults.

### Theme
The app uses a dark theme by default. Core colors are:
- Background: `gray-950`, `gray-900`
- Borders: `gray-800`
- Accent: `indigo-500`, `emerald-400`, `amber-400`, `rose-400`

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📬 Contact

Have questions or suggestions? Open an [issue](https://github.com/ruichanglyu/taskflow/issues) on GitHub.

---

Built with ❤️ using React, Vite, and Tailwind CSS

---

## 📈 Future Improvements

- Supabase authentication integration
- Multi-user collaboration
- Role-based admin dashboard
- Drag-and-drop task reordering
- Real-time updates
- Cloud storage & persistence
