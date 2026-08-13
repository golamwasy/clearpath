# The generated OpenAPI types (npm run gen:api, part of `npm run build`) read the sibling
# backend services' openapi.yaml files by relative path, so the build context has to be the repo
# root, not merchant-web/ alone — same reason menu-service/availability-service/trace-collector's
# Dockerfiles COPY the whole repo into their build stage.
FROM node:20-alpine AS build
WORKDIR /app
COPY menu-service/openapi.yaml ./menu-service/openapi.yaml
COPY availability-service/openapi.yaml ./availability-service/openapi.yaml
COPY pos-ingest/openapi.yaml ./pos-ingest/openapi.yaml
COPY trace-collector/openapi.yaml ./trace-collector/openapi.yaml
COPY merchant-web/package.json merchant-web/package-lock.json ./merchant-web/
WORKDIR /app/merchant-web
RUN npm ci
COPY merchant-web/ .

ARG VITE_MENU_API_URL=http://localhost:8081
ARG VITE_AVAILABILITY_API_URL=http://localhost:8082
ARG VITE_POS_API_URL=http://localhost:8083
ARG VITE_TRACE_API_URL=http://localhost:8084
# No default: menu-service has no seed data, so there's no venue id that's valid across
# environments. Left empty, the nav links and chaos panel just have nothing to point at yet — see
# README's Setup section for creating one and passing it through here.
ARG VITE_DEFAULT_VENUE_ID=
ENV VITE_MENU_API_URL=$VITE_MENU_API_URL \
    VITE_AVAILABILITY_API_URL=$VITE_AVAILABILITY_API_URL \
    VITE_POS_API_URL=$VITE_POS_API_URL \
    VITE_TRACE_API_URL=$VITE_TRACE_API_URL \
    VITE_DEFAULT_VENUE_ID=$VITE_DEFAULT_VENUE_ID

# This is the "fail the build on the frontend type generation check" gate: gen:api regenerates
# types from the openapi.yaml files copied in above, and tsc -b fails the build if generated
# types don't match the code that consumes them.
RUN npm run build

FROM nginx:1.27-alpine
# nginx:1.27-alpine's base Alpine packages lag behind upstream security fixes (e.g. libssl3/
# libcrypto3 CVEs); upgrade in place so the CI vuln scan doesn't fail on a fixed-upstream CVE.
RUN apk upgrade --no-cache
RUN rm -rf /usr/share/nginx/html/*
COPY merchant-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/merchant-web/dist /usr/share/nginx/html
# nginx:alpine already ships a non-root "nginx" user; unprivileged port 8080 avoids needing
# CAP_NET_BIND_SERVICE for port 80.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid
USER nginx
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
