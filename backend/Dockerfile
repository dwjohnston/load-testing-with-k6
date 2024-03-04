ARG NODE_VERSION=18.19.0

FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine AS node


# Build the backend
FROM --platform=linux/amd64  node:18 AS backend-builder
WORKDIR /app/backend
COPY package.json package-lock.json ./
RUN npm i
COPY / ./
RUN npm run build 

# Create the final image
FROM --platform=linux/amd64 nginx:alpine

# install node
COPY --from=node /usr/lib /usr/lib
COPY --from=node /usr/local/lib /usr/local/lib
COPY --from=node /usr/local/include /usr/local/include
COPY --from=node /usr/local/bin /usr/local/bin
# install supervisor
RUN apk --no-cache add ca-certificates supervisor

# Copy application 
COPY --from=backend-builder /app/backend/dist ./dist
COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisord.conf


EXPOSE 80

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
