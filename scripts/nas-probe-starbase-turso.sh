#!/bin/sh
set -eu
APP=$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)
DB=btnfrll4ubmua4nvk73y4h6u
echo "APP=$APP"
echo "=== docker logs turso/libsql/fetch ==="
docker logs --tail 300 "$APP" 2>&1 | grep -iE 'turso|libsql|fetch failed|TypeError|ECONN|ENOTFOUND|error' | tail -60 || true
echo "=== runtime env redacted ==="
docker exec "$APP" sh -c 'printenv TURSO_DATABASE_URL; printenv LIBSQL_URL; printenv TURSO_AUTH_TOKEN | wc -c' | sed 's/:[^:@]*@/:***@/g'
echo "=== http probe from app ==="
docker exec "$APP" sh -c "wget -S -O- --timeout=5 http://${DB}:8080/v2 2>&1 | head -40; echo ---; wget -S -O- --timeout=5 http://${DB}:8080/health 2>&1 | head -20; echo ---; wget -S -O- --timeout=5 http://${DB}:8080/ 2>&1 | head -20" || true
echo "=== curl-like with node if present ==="
docker exec "$APP" sh -c 'command -v node; node -e "
const http=require(\"http\");
const req=http.get(\"http://btnfrll4ubmua4nvk73y4h6u:8080/v2\",res=>{console.log(\"status\",res.statusCode);res.resume();});
req.on(\"error\",e=>console.log(\"err\",e.message));
setTimeout(()=>{},2000);
"' 2>&1 || true
echo "=== db network/ports ==="
docker port "$DB" 2>&1 || true
docker inspect "$DB" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{$v.IPAddress}}; {{end}}'
docker inspect "$APP" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{$v.IPAddress}}; {{end}}'
echo "=== db logs tail ==="
docker logs --tail 40 "$DB" 2>&1 | tail -40 || true
