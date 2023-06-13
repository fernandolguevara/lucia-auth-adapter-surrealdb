import type { Adapter, KeySchema, SessionSchema, UserSchema } from "lucia-auth";
import { LuciaError } from "lucia-auth";
import Surreal from "surrealdb.js";

type ConnectionOptions = ConstructorParameters<typeof Surreal>[1];

type Opts = {
  targets: {
    user?: string;
    session?: string;
    key?: string;
  };
};

type Args =
  | {
      surreal: Surreal;
      opts?: Opts;
    }
  | {
      uri: string;
      opts?: Opts & ConnectionOptions;
    };

const connect = async (args: Args): Promise<Surreal> => {
  const opts = args.opts || {};
  if (
    !("uri" in args) ||
    !("ns" in opts) ||
    !("db" in opts) ||
    !("user" in opts) ||
    !("pass" in opts)
  ) {
    throw "surreal:connection-args:required";
  }

  const surreal = new Surreal(args.uri, { ...args.opts });

  await surreal.wait();

  return surreal;
};

const thing = (target: string, id: string) => `${target}:${id}`;

const handleId = (target: string) =>
  `string::replace(id, '${target}:', '') AS id`;

const adapter = (args: Args): Adapter => {
  type KeySurrealSchema = Omit<KeySchema, "id"> & {
    id: string;
    key_id: string;
  };

  type RawQueryResult =
    | string
    | number
    | symbol
    | null
    | RawQueryResult[]
    | Record<string | number | symbol, unknown>;

  const {
    user: userTarget = "user",
    session: sessionTarget = "session",
    key: keyTarget = "key",
  } = args.opts?.targets || {};

  let surreal: Surreal;
  const ensureClient = async (): Promise<void> => {
    if (surreal) return;

    if ("surreal" in args) {
      if (args.surreal.status === 1) {
        throw "surreal:connection:closed";
      }
      surreal = <Surreal>args.surreal;
      return;
    }
    surreal = await connect(args);
  };

  const query = async <T extends RawQueryResult = RawQueryResult>(
    sql: string,
    vars: any
  ): Promise<T[]> => {
    await ensureClient();

    const [response] = await surreal.query<T[][]>(sql, vars);

    return response && response.status !== "OK" ? [] : response.result;
  };

  const getThing = async <T extends RawQueryResult = RawQueryResult>(
    target: string,
    id: string
  ): Promise<T | null> => {
    await ensureClient();

    const [_thing] = await query<T>(
      `SELECT *, ${handleId(
        target
      )} FROM type::table('${target}') WHERE id = $id`,
      {
        id: thing(target, id),
      }
    );

    return _thing || null;
  };

  const deleteThing = async (target: string, id: string) => {
    await ensureClient();

    await surreal.delete(thing(target, id));
  };

  const translateKeyId = (key: KeySurrealSchema): KeySchema | null => {
    if (!key) {
      return null;
    }

    const { key_id, ...rest } = key;
    rest.id = key_id;
    return rest;
  };

  const getKey = async (keyId: string): Promise<KeySchema | null> => {
    await ensureClient();

    const [key] = await query<KeySurrealSchema>(
      `SELECT *, ${handleId(
        keyTarget
      )} FROM ${keyTarget} WHERE key_id = $key_id`,
      {
        key_id: keyId,
      }
    );

    return translateKeyId(key);
  };

  const createKey = async (key: KeySchema) => {
    try {
      if (await getKey(key.id)) {
        throw new LuciaError("AUTH_DUPLICATE_KEY_ID");
      }

      const values = {
        ...key,
        id: undefined,
        key_id: key.id,
        user: `type::thing(${userTarget}, ${key.user_id})`,
      };

      const [created] = await surreal.create<KeySurrealSchema>(
        keyTarget,
        values as any
      );
      return translateKeyId(created);
    } catch (error) {
      if (error instanceof Error && error?.message?.includes("already")) {
        throw new LuciaError("AUTH_DUPLICATE_KEY_ID");
      }
      throw error;
    }
  };

  return {
    async getUser(userId) {
      return getThing<UserSchema>(userTarget, userId);
    },
    getSessionAndUserBySessionId: async (sessionId) => {
      const session = await getThing<SessionSchema>(sessionTarget, sessionId);
      if (!session) {
        return null;
      }

      const user = await getThing<UserSchema>(userTarget, session.user_id);
      if (!user) {
        return null;
      }

      return {
        user,
        session,
      };
    },
    getSession: async (sessionId) => {
      return getThing<SessionSchema>(sessionTarget, sessionId);
    },
    getSessionsByUserId: async (userId) => {
      return query<SessionSchema>(
        `SELECT *, ${handleId(
          sessionTarget
        )} FROM ${sessionTarget} WHERE user_id = $user_id`,
        { user_id: userId }
      );
    },
    setUser: async (userId, userAttributes, key) => {
      await ensureClient();

      if (key && (await getKey(key.id))) {
        throw new LuciaError("AUTH_DUPLICATE_KEY_ID");
      }

      const [user] = await surreal.create<UserSchema>(
        thing(userTarget, userId),
        {
          ...userAttributes,
          id: userId,
        }
      );

      user.id = user?.id ? user?.id.replace(`${userTarget}:`, "") : user?.id;

      if (key) {
        await createKey(key);
      }

      return user;
    },
    async deleteUser(userId) {
      await deleteThing(userTarget, userId);
    },
    setSession: async (session) => {
      await ensureClient();

      const userDoc = await getThing<UserSchema>(userTarget, session.user_id);
      if (!userDoc) throw new LuciaError("AUTH_INVALID_USER_ID");
      try {
        await surreal.create(sessionTarget, {
          ...session,
          user: `type::thing(${userTarget}, ${session.user_id})`,
        });
      } catch (error) {
        if (error instanceof Error && error?.message?.includes("already")) {
          throw new LuciaError("AUTH_DUPLICATE_SESSION_ID");
        }
        throw error;
      }
    },
    deleteSession: async (sessionId) => {
      await deleteThing(sessionTarget, sessionId);
    },
    deleteSessionsByUserId: async (userId) => {
      await ensureClient();

      await surreal.query(
        `DELETE FROM type::table($tb) WHERE user_id = $user_id`,
        {
          tb: sessionTarget,
          user_id: userId,
        }
      );
    },
    updateUserAttributes: async (userId, attributes) => {
      await ensureClient();

      const user = await getThing(userTarget, userId);

      if (!user) throw new LuciaError("AUTH_INVALID_USER_ID");

      await surreal.merge(thing(userTarget, userId), attributes);

      return (await getThing<UserSchema>(userTarget, userId)) || void 0;
    },
    getKey: async (keyId) => {
      return getKey(keyId);
    },
    setKey: async (key) => {
      const user = await getThing<UserSchema>(userTarget, key.user_id);
      if (!user) throw new LuciaError("AUTH_INVALID_USER_ID");

      await createKey(key);
    },
    getKeysByUserId: async (userId) => {
      return query<KeySurrealSchema>(
        `SELECT *, ${handleId(
          keyTarget
        )} FROM ${keyTarget} WHERE user_id = $user_id`,
        { user_id: userId }
      ).then((keys) => keys.map((k) => translateKeyId(k) as KeySchema));
    },
    updateKeyPassword: async (key, hashedPassword) => {
      if (!(await getKey(key))) {
        throw new LuciaError("AUTH_INVALID_KEY_ID");
      }

      await surreal.query(
        `UPDATE ${keyTarget} SET hashed_password = '${hashedPassword}' WHERE key_id = $key_id`,
        {
          key_id: key,
        }
      );

      return (await getKey(key)) || void 0;
    },
    deleteKeysByUserId: async (userId) => {
      ensureClient();

      await surreal.query(`DELETE FROM ${keyTarget} WHERE user_id = $user_id`, {
        user_id: userId,
      });
    },
    deleteNonPrimaryKey: async (keyId) => {
      ensureClient();

      await surreal.query(
        `DELETE FROM ${keyTarget} WHERE key_id = $key_id AND primary_key = false`,
        {
          key_id: keyId,
        }
      );
    },
  };
};

export default adapter;
