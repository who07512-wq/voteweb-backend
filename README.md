# VoteWeb Backend API

A modular backend API for a voting web application, built with Node.js, Express.js, and PostgreSQL.

## Project Overview

This is the backend foundation for a voting system that will eventually support:
- Student management
- Election management
- Club/position management
- Candidate management
- Voter authorization
- Voting and results
- Admin functionality
- Audit logging

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Configuration**: dotenv

## Prerequisites

- Node.js (v18 or higher recommended)
- npm
- PostgreSQL 16+ (or PostgreSQL 18 recommended)

## Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

## PostgreSQL Setup

### Option 1: Using DATABASE_URL (Recommended)

Set the `DATABASE_URL` environment variable with your PostgreSQL connection string:

```bash
DATABASE_URL=postgres://username:password@host:5432/database_name
```

### Option 2: Individual Connection Parameters

Alternatively, configure connection parameters individually:

```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=voteweb
DB_USER=postgres
DB_PASSWORD=your_password
```

### Creating the Database

Connect to PostgreSQL and create the database:

```sql
CREATE DATABASE voteweb;
```

Or use the psql command:

```bash
psql -U postgres -c "CREATE DATABASE voteweb;"
```

## Configuration

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment (development/production) | development |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `DB_HOST` | Database host | localhost |
| `DB_PORT` | Database port | 5432 |
| `DB_NAME` | Database name | voteweb |
| `DB_USER` | Database user | postgres |
| `DB_PASSWORD` | Database password | - |
| `DB_POOL_MIN` | Minimum pool connections | 2 |
| `DB_POOL_MAX` | Maximum pool connections | 10 |
| `DB_IDLE_TIMEOUT` | Idle timeout (ms) | 30000 |
| `DB_CONNECTION_TIMEOUT` | Connection timeout (ms) | 2000 |

## Running the Application

### Development Mode

```bash
npm run dev
```

Uses `node --watch` for automatic restart on file changes.

### Production Mode

```bash
npm start
```

### Database Health Check

To verify the database connection before starting:

```bash
npm start &
sleep 2
curl http://localhost:3000/api/health/db
```

## API Endpoints

### Health Check

**GET** `/api/health`

Returns the current status of the API.

```bash
curl http://localhost:3000/api/health
```

**Response:**

```json
{
  "status": "ok",
  "service": "voteweb-api",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Database Health Check

**GET** `/api/health/db`

Returns the current status of the database connection.

```bash
curl http://localhost:3000/api/health/db
```

**Response:**

```json
{
  "status": "ok",
  "database": "postgresql",
  "responseTime": "53ms",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Project Structure

```
voteweb/
├── src/
│   ├── config/         # Configuration files
│   │   ├─�� index.js    # Environment config loader
│   │   └── database.js # Database configuration
│   ├── db/             # Database module
│   │   └── index.js    # Connection pool and helpers
│   ├── routes/         # Express route definitions
│   │   └── health.js   # Health check routes
│   ├── controllers/    # Route handlers (reserved for future)
│   ├── middleware/     # Express middleware (reserved for future)
│   ├── app.js          # Express application setup
│   └── server.js       # Server entry point
├── .env.example        # Environment template
├── .gitignore          # Git ignore file
├── package.json        # Dependencies and scripts
└── README.md           # This file
```

## Connection Pool

The application uses a PostgreSQL connection pool for efficient database connections:

- **Minimum connections**: 2
- **Maximum connections**: 10
- **Idle timeout**: 30 seconds
- **Connection timeout**: 2 seconds

These settings can be adjusted via environment variables for production scaling.

## Graceful Shutdown

The application handles SIGTERM and SIGINT signals to ensure:
1. HTTP server stops accepting new connections
2. Database connection pool is properly closed
3. Clean exit with proper cleanup

## Development

The project uses a modular monolith architecture, making it easy to add new modules while keeping the codebase organized.

## License

ISC
