# syntax=docker/dockerfile:1.7
FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server
# Empty reports dir the runtime stage copies with --chown so the volume mount
# inherits nonroot ownership on first up.
RUN mkdir -p /reports

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/server /app/server
COPY --from=build --chown=65532:65532 /reports /data/reports
USER nonroot:nonroot
EXPOSE 8010
ENTRYPOINT ["/app/server"]
