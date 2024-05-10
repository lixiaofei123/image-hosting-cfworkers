FROM node:20-bullseye-slim

# Install dependencies
RUN apt-get -qq update && \
    apt-get install -qqy --no-install-recommends \
        ca-certificates \
        libc++-dev &&  \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8080

CMD ["sh","entrypoint.sh"]
