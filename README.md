# OrderPulse

A real-time order and transaction tracking SaaS demo. Orders arrive through a REST API or
signed webhooks, a background worker processes the webhook queue, and every connected
dashboard for that account updates live over Socket.IO.

Built to show a coherent, production-shaped use of **MongoDB + Mongoose**, **Socket.IO**,
**Express + TypeScript**, **webhooks**, **role-based auth** and **background job processing**
in one small product.

<!-- Screenshot or GIF placeholder: record the dashboard while clicking "Simulate order"
     and running `npm run webhook:send`, save it as docs/demo.gif, and uncomment: -->
<!-- ![OrderPulse live dashboard](docs/demo.gif) -->

> _Screenshot / GIF placeholder: the live dashboard updating as orders arrive._

## Features

- **Multi-tenant by design.** Every document carries an `accountId`, and every query takes it
  from the verified JWT. One account can never read or change another account's data.
- **JWT auth with roles.** Admins can cancel and delete orders and manage users. Members can
  create, view and advance orders.
- **Orders API** with pagination, a status filter, and atomic, guarded status transitions.
- **Stats from real aggregation pipelines**: revenue per day, order counts by status, top
  products by revenue. The arithmetic runs in MongoDB, not in JavaScript.
- **Signed webhooks.** `POST /webhooks/orders` verifies an HMAC-SHA256 signature over the raw
  request body and stores each event exactly once.
- **Background worker.** A Mongo-backed queue with atomic claiming, retries, exponential
  backoff and attempt counting. Processing is idempotent end to end.
- **Real-time dashboard.** Socket.IO connections are authenticated with the JWT and joined to a
  per-account room, so an event only reaches the account it belongs to.
- **Tested.** 69 tests run against a real `mongod` (via `mongodb-memory-server`), covering
  auth, roles, tenant isolation, CRUD, webhook idempotency, retries, aggregation results and
  socket delivery.

## Stack

| Layer    | Technology                                                         |
| -------- | ------------------------------------------------------------------ |
| API      | Node.js, Express 5, TypeScript, Zod (validation)                    |
| Database | MongoDB, Mongoose 9                                                |
| Realtime | Socket.IO 4                                                        |
| Auth     | JSON Web Tokens, bcrypt password hashing                           |
| Frontend | React 19, TypeScript, Vite                                         |
| Tests    | Vitest, supertest, mongodb-memory-server, socket.io-client         |

## Architecture

```
                 ┌──────────────────────── server process ────────────────────────┐
 React           │                                                                │
 dashboard ──────┼─ REST /api/* ──► routes ──► services ──► Mongoose ──► MongoDB   │
     ▲           │   (JWT, roles)               │                          ▲      │
     │           │                              │ publishToAccount()       │      │
     └─ Socket.IO ◄── room "account:<id>" ◄─────┤                          │      │
        (JWT)    │                              │                          │      │
                 │                              │                          │      │
 External ───────┼─ POST /webhooks/orders ──► WebhookEvent (status: received)      │
 system          │   (HMAC signature)           ▲                                 │
                 │                              │ claim, process, retry           │
                 │                       webhook worker (polls every second) ─────┘
                 └────────────────────────────────────────────────────────────────┘
```

- **Routes** validate input (Zod), check auth and roles, and call a service. They contain no
  database code.
- **Services** hold the business rules and are the only code that talks to the models. Every
  service function takes `accountId` as its first argument.
- **The publisher** (`realtime/publisher.ts`) is the single place that emits Socket.IO events.
  Services call it after a successful write, so REST requests and the webhook worker produce
  the same live updates.
- **The worker** runs in the same process as the API. That is deliberate for a demo: it lets
  the worker emit to the in-process Socket.IO server. To scale it out, run workers as separate
  processes and add the Socket.IO Redis adapter (or Redis emitter) so they can publish to
  sockets held by the API processes. The queue itself already supports multiple workers.

### Project layout

```
server/
  src/
    config/env.ts          Zod-validated environment
    db/connect.ts          connection + index build
    models/                Account, User, Order, WebhookEvent
    middleware/            authenticate, requireRole, error handler
    routes/                auth, users, orders, stats, webhooks
    services/              auth, order, stats (pipelines), webhook
    realtime/              Socket.IO server and publisher
    worker/                webhook queue worker
    validation/schemas.ts  request and webhook payload schemas
    scripts/               seed, send-webhook
    app.ts                 Express app (no listener, used by tests)
    bootstrap.ts           HTTP + Socket.IO + worker startup and shutdown
    dev-memory.ts          zero-setup mode on an in-memory MongoDB
  tests/                   Vitest + supertest suites
client/
  src/
    pages/                 LoginPage, DashboardPage
    components/            StatsPanel, RevenueChart, OrdersTable, StatusBadge
    hooks/useLiveOrders.ts REST load + Socket.IO sync
    api.ts, auth.tsx       API client and session context
```

## MongoDB specifics

### Schemas

| Collection      | Fields                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `accounts`      | `name`, `createdAt`                                                                                                      |
| `users`         | `accountId`, `email`, `passwordHash`, `role` (`admin` \| `member`), timestamps                                           |
| `orders`        | `accountId`, `orderId`, `customerName`, `items[{ name, qty, price }]`, `amount`, `status`, timestamps                    |
| `webhookevents` | `eventId`, `accountId`, `type`, `payload`, `status`, `attempts`, `nextAttemptAt`, `processedAt`, `lastError`, timestamps |

Notes:

- **Money is stored as integer cents** (`price`, `amount`). Sums and `qty * price` are exact in
  both JavaScript and the aggregation pipelines, with no floating-point drift.
- **`amount` is always computed on the server** from the items. A value sent by the client is
  ignored.
- Order `status` is `pending | paid | shipped | cancelled`. Allowed moves are
  `pending → paid → shipped`, and `pending | paid → cancelled`.
- Webhook event `status` is `received | processed | failed`.

### Indexes, and why each one exists

Indexes are declared explicitly in the model files, and the server waits for them to be built
before it accepts traffic, because idempotency depends on the unique ones.

| Collection      | Index                                        | Why                                                                                                                                                                                                 |
| --------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders`        | `{ orderId: 1 }` unique                      | The public identifier, and the idempotency key for webhook-created orders. The unique index is what makes "create this order" safe to retry: a second insert cannot succeed.                          |
| `orders`        | `{ accountId: 1, createdAt: -1 }`            | The dashboard query, "this account's newest orders". Equality on `accountId`, then `createdAt` in sort order, so MongoDB reads the index in order with no in-memory sort. Also serves the 14-day range in the revenue pipeline. |
| `orders`        | `{ accountId: 1, status: 1, createdAt: -1 }` | The same list with a status filter. Follows the ESR rule (Equality, Sort, Range): both equality fields, then the sort key.                                                                           |
| `webhookevents` | `{ eventId: 1 }` unique                      | Deduplication. A redelivered webhook has the same `eventId` and cannot be stored twice, even if two deliveries race.                                                                                 |
| `webhookevents` | `{ status: 1, nextAttemptAt: 1 }`            | The worker's poll: "oldest event that is still `received` and due". Without it, every poll would scan the collection.                                                                                |
| `users`         | `{ email: 1 }` unique                        | Login lookup, and one user per email.                                                                                                                                                               |
| `users`         | `{ accountId: 1 }`                           | Listing an account's users.                                                                                                                                                                         |

One trade-off worth naming: `orderId` is unique across the whole system, as the brief
specifies, rather than per account. A webhook that tries to create an `orderId` already owned
by another account is rejected and its event is marked `failed` (there is a test for this). In
a production multi-tenant system I would make the unique index `{ accountId, orderId }`.

### Aggregation pipelines

All three live in [server/src/services/stats.service.ts](server/src/services/stats.service.ts).
Each starts with a `$match` on `accountId`, so the pipeline only ever sees one tenant's
documents and can use the compound index.

**Revenue per day, last 14 days** (`GET /api/stats/revenue`)

```js
[
  { $match: {
      accountId,
      createdAt: { $gte: from, $lt: to },        // 14 UTC days, today included
      status: { $in: ['paid', 'shipped'] },       // only orders where money was taken
  } },
  { $group: {
      _id: { $dateTrunc: { date: '$createdAt', unit: 'day', timezone: 'UTC' } },
      revenue: { $sum: '$amount' },
      orders: { $sum: 1 },
  } },
  { $sort: { _id: 1 } },
  { $project: {
      _id: 0,
      date: { $dateToString: { date: '$_id', format: '%Y-%m-%d', timezone: 'UTC' } },
      revenue: 1,
      orders: 1,
  } },
]
```

The database does the bucketing and the sums. The service then fills in days that had no
revenue with zeros, so the chart always gets 14 points; that step adds no numbers of its own.

**Order counts by status** (`GET /api/stats/status`)

```js
[
  { $match: { accountId } },
  { $group: { _id: '$status', count: { $sum: 1 } } },
]
```

**Top products by revenue** (`GET /api/stats/top-products?limit=5`)

```js
[
  { $match: { accountId, status: { $in: ['paid', 'shipped'] } } },
  { $unwind: '$items' },                          // one document per line item
  { $group: {
      _id: '$items.name',
      revenue: { $sum: { $multiply: ['$items.qty', '$items.price'] } },
      unitsSold: { $sum: '$items.qty' },
      orderIds: { $addToSet: '$_id' },
  } },
  { $sort: { revenue: -1, _id: 1 } },             // name breaks ties, so order is stable
  { $limit: limit },
  { $project: { _id: 0, name: '$_id', revenue: 1, unitsSold: 1, orders: { $size: '$orderIds' } } },
]
```

A detail that is easy to get wrong: `aggregate()` does not cast values using the schema the way
`find()` does. The `accountId` string from the JWT is converted to an `ObjectId` by hand;
passing the string would silently match nothing.

## Webhooks and idempotency

Webhook senders retry. Networks duplicate and reorder. The design assumes every event may
arrive more than once, in any order, and still produces exactly one correct result.

**1. Verify.** The sender signs the raw request body:

```
X-OrderPulse-Signature: sha256=<hex HMAC-SHA256(body, WEBHOOK_SECRET)>
```

The route reads the body as raw bytes (`express.raw`), because the signature covers the exact
bytes sent, and compares signatures with `crypto.timingSafeEqual`.

**2. Store once.** The event is written with an upsert keyed on `eventId`, using only
`$setOnInsert`. A redelivery matches the existing document and writes nothing. If two
deliveries race, the unique index lets exactly one insert win. Either way the sender gets
`202 { received: true, duplicate: true | false }`, which tells it to stop retrying.

**3. Acknowledge fast, process later.** The route does no order work. The worker picks the
event up within a second.

**4. Claim atomically.** The worker claims an event with a single `findOneAndUpdate`:

```js
WebhookEvent.findOneAndUpdate(
  { status: 'received', nextAttemptAt: { $lte: now } },
  { $set: { nextAttemptAt: now + 30s }, $inc: { attempts: 1 } },
  { sort: { nextAttemptAt: 1 } },
)
```

Selecting and updating in one operation means two workers can never claim the same event.
Pushing `nextAttemptAt` forward acts as a visibility timeout: if the process dies mid-event,
the event becomes claimable again by itself, so nothing is lost.

**5. Apply idempotently.** That recovery gives _at-least-once_ processing, so every handler is
safe to run twice:

- `order.created` is an upsert on `orderId` with `$setOnInsert`. Running it again changes
  nothing, not even `updatedAt`.
- `order.paid`, `order.shipped` and `order.cancelled` are guarded transitions. The allowed
  source statuses are in the update filter, so the check and the write are one atomic step.
  A repeat is a no-op, and a stale event (for example `paid` arriving after `shipped`) is
  ignored instead of moving the order backwards.

**6. Retry or give up.**

| Situation                                                   | Result                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| Success                                                     | `processed`, `processedAt` set                                 |
| Order does not exist yet (events out of order), or a transient error | stays `received`, retried with backoff of 2s, 4s, 8s… (max 60s) |
| `WORKER_MAX_ATTEMPTS` reached                               | `failed`, with `lastError` recorded                            |
| Unknown account, or `orderId` owned by another account      | `failed` immediately, no retries                               |

A Socket.IO event is emitted only when a write actually changed something, so a duplicate
delivery never causes a duplicate row on the dashboard.

## Real-time

- The client passes its JWT in the Socket.IO handshake (`auth.token`). A missing or invalid
  token is refused before the connection is established.
- The server joins the socket to the room `account:<accountId>`, taken from the token. Clients
  cannot request a room, so there is no way to subscribe to another account.
- Events: `order:created`, `order:updated`, `order:deleted`, each emitted to that one room.
- The dashboard loads recent orders over REST, applies events as they arrive, and reloads after
  a reconnect, since events sent while offline are not replayed.

## API

All `/api` routes except register and login require `Authorization: Bearer <token>`.

| Method   | Path                          | Access        | Description                                             |
| -------- | ----------------------------- | ------------- | ------------------------------------------------------- |
| `POST`   | `/api/auth/register`          | public        | Create an account and its admin user, returns a JWT     |
| `POST`   | `/api/auth/login`             | public        | Returns a JWT                                           |
| `GET`    | `/api/auth/me`                | any user      | The current user                                        |
| `GET`    | `/api/users`                  | admin         | List the account's users                                |
| `POST`   | `/api/users`                  | admin         | Add a user (member by default) to the account           |
| `POST`   | `/api/orders`                 | any user      | Create an order                                         |
| `GET`    | `/api/orders`                 | any user      | List orders: `?page=1&limit=20&status=paid`             |
| `GET`    | `/api/orders/:orderId`        | any user      | Get one order                                           |
| `PATCH`  | `/api/orders/:orderId/status` | any user\*    | Change status. \*Setting `cancelled` requires admin     |
| `DELETE` | `/api/orders/:orderId`        | admin         | Delete an order                                         |
| `GET`    | `/api/stats/revenue`          | any user      | Revenue per day, last 14 days                           |
| `GET`    | `/api/stats/status`           | any user      | Order counts by status                                  |
| `GET`    | `/api/stats/top-products`     | any user      | Top products by revenue: `?limit=5`                     |
| `POST`   | `/webhooks/orders`            | HMAC signature | Receive an order event                                  |

Requests for another account's order return `404`, not `403`, so the response does not reveal
that the order exists.

Webhook body:

```json
{
  "eventId": "evt_123",
  "type": "order.created",
  "accountId": "<account id>",
  "data": {
    "orderId": "WH-1001",
    "customerName": "Grace Hopper",
    "items": [{ "name": "Mechanical Keyboard", "qty": 1, "price": 12900 }]
  }
}
```

`type` is one of `order.created`, `order.paid`, `order.shipped`, `order.cancelled`. The status
events only need `data.orderId`.

## Running it locally

Requirements: Node.js 20 or newer. No Docker.

```bash
npm install
```

Copy the example environment file (the placeholder secrets are fine for local use):

```bash
# macOS / Linux
cp server/.env.example server/.env
# Windows PowerShell
Copy-Item server/.env.example server/.env
```

### Option A: zero setup (in-memory MongoDB)

```bash
npm run dev:memory
```

This starts the API on an in-memory MongoDB seeded with demo data, plus the React app. The
first run downloads a `mongod` binary (roughly 800 MB on Windows), so it can take a few
minutes. Data is reset every time the server restarts.

### Option B: MongoDB Atlas (or any MongoDB)

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas), add a database
   user, and allow your IP address under Network Access.
2. Put the connection string in `server/.env`:

   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/orderpulse
   ```

3. Seed and run:

   ```bash
   npm run seed
   npm run dev
   ```

### Then

Open <http://localhost:5173> and log in with a seeded user:

| Role   | Email                   | Password          |
| ------ | ----------------------- | ----------------- |
| admin  | `admin@orderpulse.dev`  | `orderpulse-demo` |
| member | `member@orderpulse.dev` | `orderpulse-demo` |

To see the real-time behaviour:

- Click **Simulate order**. The new order appears through the Socket.IO event, not from the
  HTTP response.
- Open a second browser window. Changes made in one appear in the other.
- Send a signed webhook from a terminal, using the account id printed at startup or by the
  seed script:

  ```bash
  npm run webhook:send -- --account <accountId>
  npm run webhook:send -- --account <accountId> --type order.paid --order <orderId>
  ```

  Add `--event evt_1` and run it twice to watch the second delivery be deduplicated.

### Environment variables

Defined in [server/.env.example](server/.env.example). Only the example file is committed;
`.env` is git-ignored.

| Variable              | Purpose                                             | Default                 |
| --------------------- | --------------------------------------------------- | ----------------------- |
| `MONGODB_URI`         | MongoDB connection string                           | required                |
| `JWT_SECRET`          | Signs JWTs (16+ characters)                         | required                |
| `WEBHOOK_SECRET`      | Shared secret for webhook signatures (16+ characters) | required              |
| `PORT`                | API port                                            | `4000`                  |
| `JWT_EXPIRES_IN`      | Token lifetime                                      | `12h`                   |
| `CLIENT_ORIGIN`       | Allowed origin for CORS and Socket.IO               | `http://localhost:5173` |
| `WORKER_ENABLED`      | Run the webhook worker in this process              | `true`                  |
| `WORKER_POLL_MS`      | Queue poll interval                                 | `1000`                  |
| `WORKER_MAX_ATTEMPTS` | Attempts before an event is marked `failed`         | `5`                     |

## Tests

```bash
npm test
```

The suite starts one in-memory `mongod`, gives each test file its own database, and drives the
real Express app with supertest. No external database or network service is needed.

The first run downloads the `mongod` binary into `~/.cache/mongodb-binaries` (the same one
`npm run dev:memory` uses). After that the suite takes about ten seconds.

| File                | What it proves                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `auth.test.ts`      | Register and login, password hashing, token checks on every protected route, and what each role can and cannot do       |
| `isolation.test.ts` | An admin of account B cannot list, read, update or delete account A's orders, or see them in stats                      |
| `orders.test.ts`    | Create, read, paginate, filter, status transitions, delete, and input validation                                       |
| `webhooks.test.ts`  | Signature verification, the same `eventId` twice (and eight times concurrently) yields one order, retries, backoff, failure |
| `stats.test.ts`     | Each aggregation returns exact numbers for seeded data, including window edges and excluded statuses                   |
| `realtime.test.ts`  | Sockets need a valid JWT, and an order event reaches its own account's room and no other                               |

Other checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## What I would add for production

- Rate limiting on the auth and webhook endpoints.
- A timestamp inside the signed webhook payload, rejected when too old, to block replay of a
  captured request.
- A per-account webhook secret instead of one shared secret.
- Refresh tokens and token revocation. Tokens are currently stateless and valid until they
  expire.
- MongoDB transactions for register (account + user). It currently compensates by deleting the
  account if creating the user fails.
- Workers as separate processes, with the Socket.IO Redis adapter.
- A TTL index or archival job for old `processed` webhook events.
