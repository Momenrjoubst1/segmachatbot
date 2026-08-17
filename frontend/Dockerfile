FROM node:20-alpine AS base

# Frontend build stage
FROM base AS frontend-builder
WORKDIR /app/frontend
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Frontend production stage with nginx
FROM nginx:alpine AS frontend-production
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html

# Nginx config for SPA
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf

RUN addgroup -S nginx && adduser -S nginx -G nginx
USER nginx
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
