import index from './index.html';
import { parse } from "cookie";
import jwt from '@tsndr/cloudflare-worker-jwt'

interface Env {
	MY_BUCKET: R2Bucket;
	R2_DOMAIN: String;
	PASSWORD: string;
	SIGN_KEY: string;

}

async function checkAuth(req: Request, signKey: string, password: string) {
	const cookie = parse(req.headers.get("Cookie") || "");
	const authentication = cookie["Authentication"] || req.headers.get("authorization") || ""
	if (authentication !== "") {
		if (authentication.indexOf("Basic") === 0) {
			const encodedstr = authentication.substring(6)
			const decodedstr = Buffer.from(encodedstr, 'base64').toString('ascii');
			const userpass = decodedstr.split(":")
			return (userpass.length === 2 && userpass[1] === password)
		} else if (authentication.indexOf("Bearer") === 0) {
			let jwttoken = authentication.substring(7)
			console.log("jwt token--->", jwt)
			return await jwt.verify(jwttoken, signKey)
		}
	}
	return false
}

async function handlePutObject(request: Request, key: string,  data: ReadableStream<any> | Blob | ArrayBuffer | null, env: Env): Promise<Response> {
	await env.MY_BUCKET.put(key, data);
	const url = new URL(request.url);

	let fileurl = `${url.protocol}//${url.host}/file/${key}`
	if (env.R2_DOMAIN) {
		fileurl = `${env.R2_DOMAIN}/${key}`;
	}
	return Response.json({
		url: fileurl,
	});
}

async function handleGetObject(_request: Request, key: string, env: Env): Promise<Response> {
	const object = await env.MY_BUCKET.get(key);
	if (object === null) {
		throw new Error('Object Not Found');
	}
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);

	const response = new Response(object.body, {
		headers,
	});

	return response;
}

async function handleDeleteObject(_request: Request, key: string, env: Env): Promise<Response> {
	await env.MY_BUCKET.delete(key);
	return Response.json({});
}

async function handleObject(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
	try {
		const url = new URL(request.url);
		const key = url.pathname.substring(url.pathname.indexOf('/file/') + 6);

		switch (request.method) {
			case 'PUT':
				return await handlePutObject(request, key, request.body, env);
			case 'GET':
				const cacheKey = new URL(request.url);
				const cache = caches.default;
				let response = await cache.match(cacheKey);
				if (response) {
					console.log(`Cache hit for: ${request.url}.`);
					return response;
				}

				response = await handleGetObject(request, key, env);

				let cacheResponse = response.clone();
				cacheResponse.headers.set('Cache', 'true');

				context.waitUntil(cache.put(cacheKey, cacheResponse));
				return response;

			case 'DELETE':
				return await handleDeleteObject(request, key, env);

			default:
				throw new Error('Method is not allowed');
		}
	} catch (error: any) {
		return Response.json(
			{
				error: error.message,
			},
			{ status: 400 }
		);
	}
}

async function fetchUrl(request: Request, url: string) {
	const proxyurl = new URL(url);
	let header = new Headers(request.headers);
	header.set('Host', proxyurl.host);

	try {
		const resp = await fetch(proxyurl, {
			method: 'GET',
			headers: header,
			redirect: 'manual',
		});
		let respHeaders = new Headers(resp.headers);
		if (respHeaders.has('location')) {
			const newurl = respHeaders.get('location') || '';
			return await fetchUrl(request, newurl);
		}

		if (resp.status === 200) {
			const body = await resp.arrayBuffer()
			return body;
		}

		throw new Error("Fetch rrror")

	} catch (error) {
		throw error
	}
}

async function handleFetchUrl(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const pathname = url.pathname;
	const proxyurl = pathname.substring(pathname.indexOf('/fetchUrl/') + 10);

	try {
		const key = new URL(proxyurl).pathname.substring(1);
		const data = await fetchUrl(request, proxyurl)
		return await handlePutObject(request, key, data, env)
		
	} catch (error: any) {
		return Response.json({
			error: error.message,
		}, {
			status: 500
		})
	}
}

async function handleIndex(_request: Request, _env: Env): Promise<Response> {
	return new Response(index, {
		headers: {
			'content-type': 'text/html',
		},
	});
}

const authRoutes = [
	{
		prefix: "/file/",
		methods: "PUT,DELETE"
	},{
		prefix: "/fetchUrl/",
		methods: "POST"
	},
	{
		prefix: "/auth/check",
		methods: "POST"
	}
]

async function authMiddleware(request: Request, env: Env) {
	const PASSWORD = (env.PASSWORD || "") + ""

	if(PASSWORD === ""){
		return true
	}

	const SIGN_KEY = (env.SIGN_KEY || "abcdefg") + ""
	const url = new URL(request.url);
	const pathname = url.pathname;
	const method = request.method

	for(let i = 0; i < authRoutes.length; i++){
		const prefix = authRoutes[i].prefix
		const methods = authRoutes[i].methods
		if(pathname.indexOf(prefix) === 0 && methods.split(",").some(i => i === method)){
			console.log(pathname, "需要进行检查")
			return await checkAuth(request, SIGN_KEY, PASSWORD)
		}
	}

	return true
}

export default {
	async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
		
		const url = new URL(request.url);
		const pathname = url.pathname;

		if(await authMiddleware(request, env) === false){
			return new Response("鉴权失败", { status: 401 })
		}
		
		if (pathname === '' || pathname === '/') {
			return await handleIndex(request, env);
		}

		if (pathname.indexOf('/file/') === 0) {
			return await handleObject(request, env, context);
		}

		if (pathname.indexOf('/fetchUrl/') === 0 && request.method === "POST") {
			return handleFetchUrl(request, env)
		}

		if(pathname === "/auth/login" && request.method === "POST"){
			const PASSWORD = (env.PASSWORD || "") + ""
			const SIGN_KEY = (env.SIGN_KEY || "abcdefg") + ""

			if (PASSWORD !== "") {
				const bodyjson: any = await request.json()
				const pwd: string = bodyjson["password"]
				if (pwd === PASSWORD) {
					const authentication = await jwt.sign({ exp: Math.floor(Date.now() / 1000 + 60 * 60 * 24 * 30) }, SIGN_KEY)
					return Response.json({
						authentication: authentication
					})
				} else {
					return new Response("密码错误", { status: 401 })
				}
			} else {
				return Response.json({})
			}
		}

		if (url.pathname === "/auth/check" && request.method === "POST") {
			return new Response("", { status: 200 })
		}

		return Response.json(
			{
				error: 'Unknown error',
			},
			{ status: 400 }
		);
	},
} satisfies ExportedHandler<Env>;
