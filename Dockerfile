FROM node:8

RUN mkdir -p /usr/src/neuralyzer
WORKDIR /usr/src/neuralyzer

COPY package.json .
COPY package-lock.json .
RUN npm install --production
COPY . .

EXPOSE 8081
CMD ["node", "main", "serve"]
