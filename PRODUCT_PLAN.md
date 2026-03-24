# TaskFlow Product Plan

## Purpose

TaskFlow is no longer just a basic task manager. The app is evolving into a personal academic operating system: one place to understand what matters, what is due, what needs to be done, and when it happens.

The goal is to reduce context switching across multiple tools and make TaskFlow the primary place to check for:

- academic deadlines
- class and schedule information
- tasks and study work
- progress over time
- notes and supporting details

This document captures the current state of the app, the design principles that should guide future work, and the next major features to implement so the product stays useful instead of becoming bloated or redundant.

## Current Product State

TaskFlow currently includes:

- Supabase authentication with email/password login
- password reset flow
- cloud-synced tasks and projects
- theme customization
- task editing
- drag-and-drop kanban board
- recurring tasks
- subtasks
- task comments
- dashboard charts and overview panels
- global search
- Google Calendar integration
- calendar month view
- calendar list view
- in-app Google Calendar event creation
- in-app Google Calendar event deletion
- timeline/Gantt-style planning view

At a high level, the app currently provides these working layers:

- `Dashboard`: high-level overview and urgency signals
- `Tasks`: execution board for work in progress
- `Projects`: grouping and organization
- `Calendar`: schedule and external time-based events
- `Timeline`: long-range view of workload over time

## Core Product Problem

The main product problem is not "add more features."

The real problem is:

- how to organize all important academic information without duplication
- how to make each page useful and non-redundant
- how to support future Canvas integration without warping the app structure

If the same item appears as separate unrelated records across tasks, calendar, projects, and other views, the app will become noisy and difficult to trust.

The product therefore needs a clear information architecture with one source of truth for each kind of thing.

## Product Principles

These principles should guide all future changes:

### 1. No Redundant Objects

Do not represent the same academic item as multiple unrelated records.

Example:

- one exam should not separately exist as:
  - a calendar event
  - a task
  - a note
  - a spreadsheet-like row

Instead:

- one object should exist as the source of truth
- other parts of the app should link to it or derive from it

### 2. Every Page Must Answer a Specific Question

Each page should have a clear purpose:

- `Dashboard`: What needs my attention right now?
- `Tasks`: What do I need to work on?
- `Projects`: What area or course does this belong to?
- `Calendar`: When is everything happening?
- `Timeline`: How is my workload spread over time?
- future `Deadlines`: What important things are due?

### 3. Link, Don’t Copy

If a deadline has preparation steps, those should be linked tasks or subtasks.

If a deadline happens at a specific time, it can also appear in the calendar.

If a deadline belongs to a course, it should link to a project/course container.

The app should connect objects rather than duplicate them.

### 4. Build Toward Future Canvas Integration

Canvas is a future source of truth for academic information.

That means the app should be designed now so that Canvas can later map naturally into the model.

Potential future Canvas imports:

- assignments
- quizzes
- exams
- labs
- project due dates
- announcements
- professor notes or reminders

The app architecture should already have a clear destination for that information.

## Recommended Information Architecture

The cleanest structure for TaskFlow is:

### Projects or Courses

Purpose:

- organizational container for academic areas
- examples: `CS 1332`, `Math 2550`, `EAS 1600`

Responsibilities:

- group related tasks
- group related deadlines
- provide color identity across the app

### Deadlines

Purpose:

- source of truth for important academic items
- examples: assignment, exam, quiz, lab, project milestone

Responsibilities:

- store what is due and when
- hold notes and context
- connect to tasks
- optionally connect to calendar
- eventually receive imported items from Canvas

This is the major missing layer in the current app.

### Tasks

Purpose:

- actionable work required to prepare for a deadline or finish a project

Examples:

- review trees and heaps
- finish problem set
- create flashcards
- write project outline

Responsibilities:

- execution workflow
- kanban
- recurrence when useful
- subtasks for finer-grained work
- comments for supporting notes

### Subtasks

Purpose:

- small units of work or topic checklists inside a task

Examples:

- study recursion
- review graph traversals
- complete question set 1

This is already a strong fit for exam topic lists and assignment breakdowns.

### Calendar Events

Purpose:

- time-based scheduling
- class sessions
- meetings
- scheduled study blocks
- exam times
- optional deadline visibility

Responsibilities:

- answer "when"
- act as the schedule layer
- support time-based planning

### Timeline

Purpose:

- show workload spread across time
- show due-date-driven work visually
- make future bottlenecks visible

Responsibilities:

- visual planning horizon
- support long-range awareness

## The Major Next Feature: Deadlines

The next major product feature should be a dedicated `Deadlines` page inside TaskFlow.

This page should be inspired by the spreadsheet-style academic tracker already being used manually.

The purpose of this page is to give a dense, scan-friendly master list of all important academic items without forcing them into tasks or calendar prematurely.

### Why Deadlines Should Exist

A deadline is not the same as a task.

A deadline represents something important that is due.

A task represents work done because of that deadline.

Examples:

- `Exam 1` is a deadline
- `study chapter 3` is a task
- `review chapter 3 topics` could be subtasks
- `Exam 1 at 6:50 PM` can also appear on the calendar

This distinction solves the redundancy problem.

### Deadlines Page Goals

The page should:

- show all important academic items in one place
- be faster to scan than the calendar
- be denser and more structured than the task board
- support notes and classification
- allow linking deadlines to tasks/subtasks/projects/calendar

### Proposed Deadline Fields

Initial fields:

- `id`
- `title`
- `course` or `projectId`
- `status`
- `type`
- `dueDate`
- `dueTime`
- `notes`
- `createdAt`

Recommended status values:

- `not-started`
- `in-progress`
- `done`
- `missed`

Recommended type values:

- `assignment`
- `exam`
- `quiz`
- `lab`
- `project`
- `other`

Potential later fields:

- `source` (`manual`, `canvas`)
- `externalId`
- `calendarEventId`
- `linkedTaskCount`
- `importance`
- `estimatedEffort`

### Proposed Deadlines UI

The Deadlines page should initially be table/list based, not card-based.

Suggested columns:

- status
- course
- date
- time
- title
- type
- notes

Optional later columns:

- linked tasks
- calendar
- priority

Suggested interactions:

- add deadline
- edit deadline
- sort by date
- filter by course
- filter by type
- filter by status
- open details drawer or modal

### Deadline Details View

Clicking a deadline should open a detail panel or modal with:

- full title
- course/project
- due date and time
- notes
- linked tasks
- linked subtasks
- calendar link or event status
- future imported metadata from Canvas

This would allow the user to move from "what is due" into "what do I need to do about it" without duplication.

## How Deadlines Should Connect to Existing Features

### Deadlines and Tasks

A deadline may optionally create one or more tasks.

Examples:

- deadline: `CS 1332 Exam 1`
- linked tasks:
  - review trees
  - review heaps
  - complete practice test

This relationship should be:

- one deadline to many tasks
- optional

Deadlines should not automatically be tasks by default.

### Deadlines and Subtasks

Subtasks are ideal for topic lists.

Examples:

- task: `Study for Exam 1`
- subtasks:
  - BST review
  - heap review
  - graph traversals

This means the current subtask system already solves part of the academic-planning problem.

### Deadlines and Projects/Courses

Each deadline should belong to a course or project whenever possible.

This allows:

- filtering by course
- color coding
- aggregation on dashboard
- future Canvas mapping by course

### Deadlines and Calendar

Deadlines can optionally appear on the calendar.

Important distinction:

- not every deadline needs to create a separate calendar event
- some may simply be shown visually on the date
- some may be explicitly promoted into full events

Recommended approach:

- deadline remains the source of truth
- calendar may reference it visually
- optional full event creation can happen when useful

### Deadlines and Timeline

Deadlines should influence the timeline by:

- serving as visible anchors for due dates
- informing when related tasks matter
- making upcoming heavy periods easier to see

Timeline should remain workload-focused, not become a second spreadsheet.

## Why This Fits the Long-Term Vision

The long-term goal is for TaskFlow to be the only app needed as the daily reference point.

That means the app should eventually cover:

- what is due
- what needs to be done
- when things happen
- how much work is coming up
- what course or area everything belongs to

The future vision is:

- `Deadlines` for important academic commitments
- `Tasks` for execution
- `Subtasks` for breakdown
- `Calendar` for schedule
- `Timeline` for long-range planning
- `Projects/Courses` for grouping

That is a coherent system.

## Future Canvas Integration Strategy

Canvas should not be implemented immediately, but the architecture should support it.

When Canvas is added later, it should map to the existing structure rather than introduce a parallel system.

Recommended Canvas mapping:

- Canvas assignments -> Deadlines
- Canvas quizzes/exams -> Deadlines
- Canvas course context -> Projects/Courses
- Canvas announcements -> future Notes or Updates layer
- teacher comments or topic reminders -> notes on deadlines or related tasks

This is why the Deadlines model matters so much: it creates a clear landing zone for academic data.

## Recommended Implementation Order

### Phase 1: Stabilize and Clarify Current Architecture

Goals:

- keep current pages purposeful
- avoid overlap
- document roles of each page

Tasks:

- review dashboard role
- ensure timeline, calendar, and task board each have distinct purposes
- update outdated README later

### Phase 2: Add Deadlines Core Model

Goals:

- create a first-class `Deadline` entity
- store it in Supabase
- support manual CRUD in the app

Tasks:

- add types
- add Supabase table
- add row-level security
- add store methods
- add basic seed/migration strategy if needed

### Phase 3: Build Deadlines Page

Goals:

- create a spreadsheet-like academic tracker inside TaskFlow

Tasks:

- add sidebar tab
- create list/table UI
- add create/edit flow
- add filtering and sorting
- support notes and status

### Phase 4: Connect Deadlines to Existing Layers

Goals:

- make deadlines useful across the app without duplication

Tasks:

- link deadlines to projects/courses
- support "create task from deadline"
- support "view linked tasks"
- optionally surface deadlines on calendar
- optionally surface deadlines in timeline

### Phase 5: Future Canvas Import

Goals:

- allow Canvas to feed the deadlines system

Tasks:

- define auth approach
- map Canvas objects to deadlines
- prevent duplicate imports
- support notes/announcement strategies later

## Non-Goals for the Next Step

These should not be done immediately:

- full Canvas integration
- a generic notes system without a clear purpose
- duplicating deadlines directly into tasks by default
- stuffing deadline tracking directly into the calendar page
- creating multiple unrelated representations of the same academic item

## Immediate Next Product Recommendation

The next major feature to implement should be:

`Deadlines page and deadline data model`

Why this is the right next move:

- it fills the biggest current product gap
- it matches the manual workflow already being used
- it makes current features more useful
- it prepares the app for future Canvas integration
- it avoids redundancy if designed as the source of truth for academic due items

## Summary

TaskFlow should become a connected academic planning system, not just a collection of features.

The architecture should be:

- `Deadlines` = what matters and when it is due
- `Tasks` = what needs to be done
- `Subtasks` = how work is broken down
- `Calendar` = when things happen
- `Timeline` = how work is distributed over time
- `Projects/Courses` = where things belong

The main product improvement now is not another random page or integration.

The main improvement is to add the missing `Deadlines` layer in a way that connects the entire app and makes future integrations fit naturally.
