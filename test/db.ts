
import type { Database } from "@lucia-auth/adapter-test";
import dotenv from "dotenv";
import { SessionSchema, UserSchema } from "lucia-auth";
import { resolve } from "path";
import Surreal from "surrealdb.js";
import adapterFn from "../src/index.js";

dotenv.config({
	path: `${resolve()}/.env`
});

const {
	SURREALDB_URL: url,
	SURREALDB_USER: user,
	SURREALDB_PASS: pass,
	SURREALDB_NS: ns,
	SURREALDB_DB: dbName
} = process.env;

if (!url || !user || !pass || !ns || !dbName) throw new Error(".env is not set up");

const surreal = await (new Promise<Surreal>((resolve, reject) => {
	const surreal = new Surreal(url);

	surreal.signin({ user, pass }).then(() => {
		return surreal.use(ns, dbName).then(() => {
			resolve(surreal);
		});
	}).catch(reject);
}));

export const adapter = adapterFn({ surreal });

export const db: Database = {
	getUsers: async () => {
		return surreal.select<UserSchema>('user').then((users) => {
			return users.map((user) => {
				if (user && typeof user === 'object' && 'id' in user && typeof user.id === 'string') {
					user.id = user.id.replace('user:', '')
				}

				return user;
			})
		})
	},
	getSessions: async () => {
		return surreal.select<SessionSchema>('session').then((sessions) => {
			return sessions.map((session) => {
				if (session && typeof session === 'object' && 'id' in session && typeof session.id === 'string') {
					session.id = session.id.replace('user:', '')
				}

				return session;
			})
		})
	},
	insertUser: async (user) => {
		const thing = `user${user.id ? `:${user.id}` : ''}`
		await surreal.create(thing, user);
	},
	insertSession: async (session) => {
		const thing = `session${session.id ? `:${session.id}` : ''}`
		await surreal.create(thing, session);
	},
	clearUsers: async () => {
		await surreal.delete('user');
	},
	clearSessions: async () => {
		await surreal.delete('session');
	}
};
