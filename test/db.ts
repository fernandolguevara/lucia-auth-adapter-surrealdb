import { LuciaQueryHandler, TestUserSchema } from "@lucia-auth/adapter-test";
import dotenv from "dotenv";
import { KeySchema, SessionSchema, UserSchema } from "lucia-auth";
import { resolve } from "path";
import Surreal from "surrealdb.js";
import adapterFn from "../src/index.js";

dotenv.config({
  path: `${resolve()}/.env`,
});

const {
  SURREALDB_URL: url,
  SURREALDB_USER: user,
  SURREALDB_PASS: pass,
  SURREALDB_NS: ns,
  SURREALDB_DB: dbName,
} = process.env;

if (!url || !user || !pass || !ns || !dbName)
  throw new Error(".env is not set up");

const surreal = await new Promise<Surreal>((resolve, reject) => {
  const surreal = new Surreal(url);

  surreal
    .signin({ user, pass })
    .then(() => {
      return surreal.use({ ns, db: dbName }).then(() => {
        resolve(surreal);
      });
    })
    .catch(reject);
});

export const adapter = adapterFn({ surreal });

type KeySurrealSchema = Omit<KeySchema, "id"> & { id: string; key_id: string };
const translateKeyId = (key: KeySurrealSchema): KeySchema | null => {
  if (!key) {
    return null;
  }

  const { key_id, ...rest } = key;
  rest.id = key_id;
  return rest;
};

export const db: LuciaQueryHandler = {
  user: {
    async get() {
      return surreal.select<UserSchema>("user").then((users) => {
        return users.map((user) => {
          if (
            user &&
            typeof user === "object" &&
            "id" in user &&
            typeof user.id === "string"
          ) {
            user.id = user.id.replace("user:", "");
          }

          return user as TestUserSchema;
        });
      });
    },
    async insert(user: TestUserSchema) {
      const thing = `user${user.id ? `:${user.id}` : ""}`;
      await surreal.create(thing, user);
    },
    async clear() {
      await surreal.delete("user");
    },
  },
  session: {
    async get() {
      return surreal.select<SessionSchema>("session").then((sessions) => {
        return sessions.map((session) => {
          if (
            session &&
            typeof session === "object" &&
            "id" in session &&
            typeof session.id === "string"
          ) {
            session.id = session.id.replace("session:", "");
          }

          return session;
        });
      });
    },
    async insert(session) {
      const thing = `session${session.id ? `:${session.id}` : ""}`;
      await surreal.create(thing, session);
    },
    async clear() {
      await surreal.delete("session");
    },
  },
  key: {
    async get() {
      return surreal.select<KeySurrealSchema>("key").then((keys) => {
        return keys.map((key) => {
          return translateKeyId(key) as KeySchema;
        });
      });
    },
    async insert(key) {
      await surreal.create("key", { ...key, id: undefined, key_id: key.id });
    },
    async clear() {
      await surreal.delete("key");
    },
  },
};
