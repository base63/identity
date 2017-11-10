FROM heroku/heroku:16

MAINTAINER NeonCity team <horia141@gmail.com>

ARG GEMFURY_USER
ARG GEMFURY_API_KEY

# Install global packages.

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
            git \
            nodejs-legacy \
            npm && \
    apt-get clean

# Setup directory structure.

RUN mkdir /neoncity
RUN mkdir /neoncity/build
RUN mkdir /neoncity/out
RUN mkdir /neoncity/var

# Setup users and groups.

RUN groupadd neoncity && \
    useradd -ms /bin/bash -g neoncity neoncity

# Install package requirements.

# COPY package.json /neoncity/package.json
# RUN cd /neoncity && npm install --registry=https://npm-proxy.fury.io/${GEMFURY_API_KEY}/${GEMFURY_USER}/ --progress=false

# Copy source code.

COPY . /neoncity

# Setup the runtime environment for the application.

ENV ENV LOCAL
ENV ADDRESS 0.0.0.0
ENV PORT 10000
ENV DATABASE_URL postgresql://neoncity:neoncity@neoncity-postgres:5432/neoncity
ENV DATABASE_MIGRATIONS_DIR /neoncity/migrations
ENV DATABASE_MIGRATIONS_TABLE migrations_identity
ENV ORIGIN http://localhost:10001
ENV CLIENTS http://localhost:10002,http://localhost:10003
ENV AUTH0_CLIENT_ID null
ENV AUTH0_DOMAIN null
ENV LOGGLY_TOKEN null
ENV LOGGLY_SUBDOMAIN null
ENV ROLLBAR_TOKEN null
ENV SECRETS_PATH /neoncity/var/secrets.json

RUN chown -R neoncity:neoncity /neoncity/build
RUN chown -R neoncity:neoncity /neoncity/out
RUN chown -R neoncity:neoncity /neoncity/var
VOLUME ["/neoncity/src"]
VOLUME ["/neoncity/migrations"]
VOLUME ["/neoncity/node_modules"]
VOLUME ["/neoncity/var/secrets.json"]
WORKDIR /neoncity
EXPOSE 10000
USER neoncity
ENTRYPOINT ["npm", "run", "serve-dev"]
