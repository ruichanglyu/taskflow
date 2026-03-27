# TaskFlow

**Live Demo:** https://taskflow-sable-omega.vercel.app/

A personal academic planner and life management app. One place for deadlines, tasks, schedules, workouts, and an AI assistant — built to reduce context switching across multiple tools.

![React](https://img.shields.io/badge/React-19-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-7-purple?logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-blue?logo=tailwindcss)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?logo=supabase)

---

## Features

- **Dashboard** — Stats overview with task counts, completion rate, recent activity, and per-project progress
- **Task Board** — Kanban columns (To Do / In Progress / Done) with drag-and-drop, search, priority and project filters
- **Deadlines** — Academic deadline tracker with CSV import, status tracking, course filtering, and type categorization
- **Calendar** — Monthly calendar view with timeline and event creation
- **Projects** — Course/project management with color coding, task counts, and progress bars
- **Gym Planner** — Workout plan builder with a guided wizard flow, exercise library, sets/reps/rest tracking, and workout logging
- **AI Assistant** — Built-in chat powered by Google Gemini with streaming responses, full app context awareness, and the ability to generate importable tasks/deadlines
- **Theming** — Multiple color palettes with light/dark mode, powered by CSS custom properties
- **Auth** — Email/password authentication with Supabase, including password reset
- **Canvas Integration** — Connect to Canvas LMS to sync course data
- **Global Search** — Search across tasks, deadlines, and projects from anywhere

---

## Tech Stack

| Technology | Purpose |
|---|---|
| [React 19](https://react.dev) | UI framework |
| [TypeScript 5.9](https://typescriptlang.org) | Type safety |
| [Vite 7](https://vite.dev) | Build tool and dev server |
| [Tailwind CSS 4](https://tailwindcss.com) | Utility-first styling with custom theming |
| [Supabase](https://supabase.com) | Auth, PostgreSQL database, storage, RLS |
| [Google Gemini API](https://ai.google.dev) | AI assistant (Gemini 3.1 Flash Lite) |
| [@hello-pangea/dnd](https://github.com/hello-pangea/dnd) | Drag-and-drop for task board |
| [Lucide React](https://lucide.dev) | Icons |
| [vite-plugin-singlefile](https://github.com/nicbarker/vite-plugin-singlefile) | Single-file production builds |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- A [Supabase](https://supabase.com) project (for auth and database)

### Installation

```bash
git clone https://github.com/ruichanglyu/taskflow.git
cd taskflow
npm install
npm run dev
```

The app runs at `http://localhost:5174`.

### Environment Variables

Create a `.env` file in the project root:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Build

```bash
npm run build
```

Outputs a single-file production build to `dist/`.

---

## AI Assistant

The built-in AI assistant uses Google Gemini's free tier API. To set it up:

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click "Create API key in new project"
3. Paste the key into the AI panel in the app

The assistant has full context of your tasks, deadlines, projects, and schedule. It can answer questions, help plan, and generate importable task/deadline blocks.

---

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project at [vercel.com](https://vercel.com)
3. Set environment variables
4. Deploy

---

## License

[MIT](LICENSE)
