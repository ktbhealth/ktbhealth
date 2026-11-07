import { index, physical, rootRoute, route } from "@tanstack/virtual-file-routes";

// Host-composed route tree. Plugin subtrees attach here; the generator
// still emits routeTree.gen.ts, so typesafety + code splitting hold.
export const routes = rootRoute("__root.tsx", [
	index("index.tsx"),
	route("consultas", [index("consultas/index.tsx"), route("$id", "consultas/$id.tsx")]),
	route("consulta", [route("nova", "consulta/nova.tsx")]),
	route("teste-captura", "teste-captura.tsx"),
	physical("/api", "api"),
]);
