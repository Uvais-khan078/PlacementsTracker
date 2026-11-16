# Placement Tracker

A full-stack application to track your placement journey — applications, interviews, and offers.

## Project Structure

```
PlacementTrcker/
├── backend/       # Node.js + Express API
└── frontend/      # React (Vite) frontend
```

## Getting Started

### Backend

```bash
cd backend
npm install
npm run dev        # starts on http://localhost:5000
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # starts on http://localhost:5173
```

## Tech Stack

- **Frontend:** React 19, Vite
- **Backend:** Node.js, Express
- **Database:** MongoDB (via Mongoose) — configure `MONGO_URI` in `backend/.env`
- **Auth:** JWT (via jsonwebtoken + bcryptjs)
