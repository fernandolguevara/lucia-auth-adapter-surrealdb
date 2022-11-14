# `lucia-auth-adapter-surrealdb`

[SurrealDB](https://surrealdb.com/) adapter for Lucia

**[Lucia documentation](https://lucia-auth.vercel.app)**

**[Changelog](https://github.com/fernandolguevara/lucia-auth-adapter-surrealdb/CHANGELOG.md)**

## Installation

```
npm install lucia-auth-adapter-surrealdb
pnpm install lucia-auth-adapter-surrealdb
yarn add lucia-auth-adapter-surrealdb
```

## Usage
```js
// required imports
import lucia from "lucia-auth";
import surrealdb from "lucia-auth-adapter-surrealdb";

// init surrealdb adapter 
const adapter = surrealdb({
    uri: 'surrealdb-uri', // Example: 'http://localhost:8000/rpc',
    user: 'surrealdb-user',
    pass: 'surrealdb-pass',
    ns: 'my-ns',
    db: 'my-db'
});

// init lucia using the adapter
const auth = lucia({
    adapter,
    env: 'DEV'
});

// OR
// only if you want to build the surrealdb client yoursef 
import Surreal from "$lib/surreal";

// build and init surrealdb client
const surreal = new Surreal('surrealdb-uri');

await surreal.signin({
    user: 'surrealdb-user',
    pass: 'surrealdb-pass',
});

await surreal.use('my-ns', 'my-db');

// init lucia passing surrealdb client to the adapter
const adapter = surrealdb({
    surreal
});

// init lucia using the adapter
const auth = lucia({
    adapter,
    env: 'DEV'
});

export type Auth = typeof auth;

// enjoy
```

## Lucia version compatibility

| Surrealdb adapter version | Lucia version |
| ------------------------- | ------------- |
| v0.0.x                    | v0.1.x        |


## Testing

Add your .env file with your configuration
```
SURREALDB_URL=
SURREALDB_USER=
SURREALDB_PASS=
SURREALDB_NS=
SURREALDB_DB=
```

```
pnpm run test-main
```
