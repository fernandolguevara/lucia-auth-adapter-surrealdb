import type { Adapter, SessionSchema, UserSchema } from "lucia-auth";
import { LuciaError } from "lucia-auth";
import { getUpdateData } from "lucia-auth/adapter";
import Surreal, { type Result } from "surrealdb.js";

type Opts = {
	targets: {
		user: string,
		session: string
	}
};

export type Args = {
	surreal: Surreal,
	opts?: Opts
} | {
	uri: string;
	token?: string;
	user: string;
	pass: string;
	ns: string;
	db: string;
	opts?: Opts
}

const connect = async (args: Args): Promise<Surreal> => {
	if (!("uri" in args) || !("ns" in args) || !("db" in args) || !("user" in args) || !("pass" in args)) {
		throw 'surreal:connection-args:required'
	}

	const surreal = new Surreal(args.uri, args.token);

	await surreal.signin({ user: args.user, pass: args.pass });

	await surreal.use(args.ns, args.db);

	return surreal;
}

type ResultUser = Result<UserSchema[]>[];
type ResultSession = Result<SessionSchema[]>[];
type SessionAndUser = SessionSchema & { user: UserSchema };
type ResultSessionAndUser = Result<SessionAndUser[]>[];

const handleId = (target: string) => `(string::replace(id, '${target}:', '')) AS id`

const ql = (db: Surreal, targets: Opts["targets"]) => ({
	createUser: (id: string | null,
		{ providerId: provider_id, hashedPassword: hashed_password, attributes }: {
			providerId: string;
			hashedPassword: string | null;
			attributes: Record<string, any>;
		}) => db.create(`${targets.user}${id ? `:${id}` : ''}`, {
			id,
			provider_id,
			hashed_password,
			...attributes
		}),
	deleteUser: (id: string) => db.delete(`${targets.user}:${id}`),
	updateUser: (id: string, data: any) => db.change<UserSchema>(`${targets.user}:${id}`, data),
	userById: (userId: string) => db.query<ResultUser>(
		`SELECT *, ${handleId(targets.user)} FROM type::table($tb)`, {
		tb: `${targets.user}:${userId}`,
	}),
	userByProviderId: (providerId: string) => db.query<ResultUser>(
		`SELECT *, ${handleId(targets.user)} FROM type::table($tb) where provider_id = $provider_id`, {
		tb: targets.user,
		provider_id: providerId
	}),
	userBySessionId: (sessionId: string) => db.query<ResultUser>(
		`SELECT *, ${handleId(targets.session)} FROM type::table($tb) FETCH user`, {
		tb: `${targets.session}:${sessionId}`,
	}),
	sessionById: <T = ResultSession>(sessionId: string) => db.query<T>(
		`SELECT *, ${handleId(targets.session)} FROM type::table($tb) FETCH`, {
		tb: `${targets.session}:${sessionId}`,
	}),
	sessionByUserId: (userId: string) => db.query<ResultSession>(
		`SELECT *, ${handleId(targets.session)} FROM type::table($tb) WHERE user_id = $user_id FETCH user`, {
		tb: `${targets.session}`,
		user_id: userId
	}),
	deleteSession: (...sessionId: string[]) => Promise.all(sessionId.map(id => db.delete(`${targets.session}:${id}`))),
	createSession: (id: string, data: SessionSchema) => db.create(`${targets.user}${id ? `:${id}` : ''}`, {
		...data,
		user: `type::thing(${targets.user}, ${data.user_id})`
	}),
	deleteSessionsByUserId: (userId: string) => db.query(`DELETE FROM type::table($tb) WHERE user_id = $user_id`, {
		$tb: targets.session,
		user_id: userId
	})
})

const checkUser = async (queries: ReturnType<typeof ql>, userId: string) => {
	const exists = await queries.userById(userId)

	if (!exists?.[0]?.result?.length) {
		throw new LuciaError("AUTH_INVALID_USER_ID");
	}
}

const adapter = (
	args: Args,
	errorHandler: (error: Error) => void = () => { }
): Adapter => {
	let _surreal: Promise<Surreal>;

	if ("surreal" in args) {
		_surreal = Promise.resolve(args.surreal);
	} else {
		_surreal = connect(args);
	}

	const targets = args.opts?.targets || { user: 'user', session: 'session' };

	return {
		getUser: async (userId: string) => {
			try {
				const results = await ql(await _surreal, targets)
					.userById(userId)

				const response = results?.[0];

				if (response?.error) {
					throw response.error;
				}

				const user = response?.result?.[0];

				return user || null;
			} catch (error: any) {
				errorHandler(error);
				throw error;
			}
		},
		getUserByProviderId: async (providerId: string) => {
			try {
				const results = await ql(await _surreal, targets)
					.userByProviderId(providerId)

				const response = results?.[0];

				if (response?.error) {
					throw response.error;
				}

				return response?.result?.[0] || null;
			} catch (error: any) {
				errorHandler(error);
				throw error;
			}
		},
		getSessionAndUserBySessionId: async (sessionId: string): Promise<{
			user: UserSchema;
			session: SessionSchema;
		} | null> => {
			try {
				const results = await ql(await _surreal, targets)
					.sessionById<ResultSessionAndUser>(sessionId)

				const response = results?.[0];

				if (response?.error) {
					throw response.error;
				}

				const result = response?.result?.[0];

				return result ? { session: { ...result }, user: result.user } : null;
			} catch (error: any) {
				errorHandler(error);
				throw error;
			}
		},
		getSession: async (sessionId: string) => {
			try {
				const results = await ql(await _surreal, targets)
					.sessionById(sessionId)

				const response = results?.[0];

				if (response?.error) {
					throw response.error;
				}

				return response?.result?.[0] || null;
			} catch (error: any) {
				errorHandler(error);
				throw error;
			}
		},
		getSessionsByUserId: async (userId: string) => {
			try {
				const results = await ql(await _surreal, targets)
					.sessionByUserId(userId);

				const response = results?.[0];

				if (response?.error) {
					throw response.error;
				}

				return response?.result;
			} catch (error: any) {
				errorHandler(error);
				throw error;
			}
		},
		setUser: async (userId: string | null, data: {
			providerId: string;
			hashedPassword: string | null;
			attributes: Record<string, any>;
		}): Promise<UserSchema> => {
			try {
				const response = await ql(await _surreal, targets)
					.createUser(userId, data);

				if (response?.id) {
					response.id = response?.id.replace('user:', '')
				}

				return response;
			} catch (error: { message?: string } & any) {
				if (error?.message?.includes("provider_id") && error?.message?.includes("already contains")) {
					throw new LuciaError("AUTH_DUPLICATE_PROVIDER_ID");
				}
				errorHandler(error);
				throw error;
			}
		},
		deleteUser: async (userId: string) => {
			try {
				await ql(await _surreal, targets)
					.deleteUser(userId);
			} catch (error: any) {
				errorHandler(error);
				throw error;
			}
		},
		setSession: async (sessionId, data) => {
			try {
				const _ql = ql(await _surreal, targets);

				await checkUser(_ql, data.userId)

				await _ql
					.createSession(sessionId, {
						id: sessionId,
						expires: data.expires,
						idle_expires: data.idlePeriodExpires,
						user_id: data.userId
					});
			} catch (error: any) {
				// if (error.details.includes("(id)") && error.details.includes("already exists.")) {
				// 	throw new LuciaError("AUTH_DUPLICATE_SESSION_ID");
				// }
				if (!(error instanceof LuciaError)) {
					errorHandler(error);
				}
				throw error;
			}
		},
		deleteSession: async (...sessionIds) => {
			try {
				await ql(await _surreal, targets)
					.deleteSession(...sessionIds);
			} catch (error: any) {
				errorHandler(error);
				throw error;
			}
		},
		deleteSessionsByUserId: async (userId) => {
			try {
				await ql(await _surreal, targets)
					.deleteSessionsByUserId(userId);
			} catch (error: any) {
				errorHandler(error);
				throw error;
			}
		},
		updateUser: async (userId, newData: {
			providerId?: string | null;
			hashedPassword?: string | null;
			attributes?: Record<string, any>;
		}) => {
			try {
				const _ql = ql(await _surreal, targets);

				await checkUser(_ql, userId)

				const dbData = getUpdateData(newData);

				const response = await _ql
					.updateUser(userId, dbData);

				if (response && "id" in response && response.id) {
					response.id = response?.id.replace('user:', '')
				}

				return response as any;
			} catch (error: { message?: string } & any) {
				if (error?.message?.includes("provider_id") && error?.message?.includes("already contains")) {
					throw new LuciaError("AUTH_DUPLICATE_PROVIDER_ID");
				}
				if (!(error instanceof LuciaError)) {
					errorHandler(error);
				}
				throw error;

			}
		}
	};
};

export default adapter;
