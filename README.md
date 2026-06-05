# DriveWize Backend API

Node.js backend API for the DriveWize GPS Tracking System.

## Tech Stack

- **Runtime**: Node.js 18+ with TypeScript 5+
- **Framework**: Express 4.18+
- **WebSocket**: Socket.IO 4.6+
- **Database**: PostgreSQL 15+ with Drizzle ORM
- **Cache**: Redis 7+
- **Authentication**: Auth0
- **Validation**: Zod
- **Logging**: Pino

## Prerequisites

- Node.js 18+ and npm 9+
- Docker and Docker Compose (for local development)
- PostgreSQL 15+
- Redis 7+

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` and update the following values:
- Database credentials
- Redis connection
- Auth0 configuration (domain, client ID, client secret)
- JWT secret
- CORS origins

### 3. Start Database and Redis

Use Docker Compose from the root directory:

```bash
cd ..
docker-compose up -d
```

This will start:
- PostgreSQL on port 5432
- Redis on port 6379

### 4. Generate and Push Database Schema

```bash
npm run db:generate
npm run db:push
```

### 5. Run Development Server

```bash
npm run dev
```

The API will be available at `http://localhost:3000`

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Lint TypeScript files
- `npm run lint:fix` - Lint and auto-fix issues
- `npm run format` - Format code with Prettier
- `npm run db:generate` - Generate Drizzle migration files
- `npm run db:push` - Push schema changes to database
- `npm run db:studio` - Open Drizzle Studio (database GUI)

## Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files (database, redis, auth)
│   ├── db/              # Database schema and migrations (Drizzle)
│   ├── middleware/      # Express middleware (auth, error handling, validation)
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic
│   ├── websocket/       # WebSocket handlers
│   ├── types/           # TypeScript type definitions
│   └── index.ts         # Application entry point
├── tests/               # Test files
├── package.json
├── tsconfig.json
└── .env.example
```

## API Endpoints

Base URL: `http://localhost:3000/api`

### Authentication
- `POST /api/auth/login` - Login with Auth0 token
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Drivers
- `GET /api/drivers` - List all drivers
- `GET /api/drivers/:id` - Get driver by ID
- `POST /api/drivers` - Create new driver
- `PUT /api/drivers/:id` - Update driver
- `DELETE /api/drivers/:id` - Delete driver
- `PATCH /api/drivers/:id/status` - Update driver status

### Locations
- `POST /api/locations` - Submit location update
- `GET /api/locations/:driverId` - Get driver location history
- `GET /api/locations/active` - Get all active driver locations

### Trips
- `POST /api/trips` - Start new trip
- `PUT /api/trips/:id` - End trip
- `GET /api/trips/:driverId` - Get driver trip history

### Reports
- `GET /api/reports/export` - Export data (CSV/PDF)
- `GET /api/reports/driver/:id` - Get driver report
- `GET /api/reports/fleet` - Get fleet report

### Admin
- `GET /api/admin/users` - List admin users
- `POST /api/admin/users` - Create admin user
- `PUT /api/admin/users/:id` - Update admin user

## WebSocket Events

Connect to `ws://localhost:3000`

### Client → Server
- `authenticate` - Authenticate with JWT token
- `location:update` - Send location update (drivers only)
- `driver:status` - Update driver status

### Server → Client
- `authenticated` - Authentication successful
- `location:ack` - Location update acknowledged
- `location:broadcast` - Real-time location update (admins only)
- `driver:status_change` - Driver status changed
- `driver:online` - Driver went online
- `driver:offline` - Driver went offline
- `error` - Error occurred

## Environment Variables

See `.env.example` for all available configuration options.

## Development Notes

- TypeScript strict mode is enabled
- Code must pass linting and type checking before commit
- Maintain 80%+ test coverage
- Follow conventional commit message format
- Use Zod for request validation
- Log all important events with Pino

## Docker Support

Build production image:

```bash
docker build -t drivewize-backend .
```

Run container:

```bash
docker run -p 3000:3000 --env-file .env drivewize-backend
```

## License

MIT
