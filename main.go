package main

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"gold-sprint/server"
)

func main() {

	mux := http.NewServeMux()

	mux.Handle(
		"/",
		http.FileServer(
			http.Dir("./web"),
		),
	)

	mux.HandleFunc(
		"/ws",
		server.WebSocketHandler,
	)

	httpServer := &http.Server{
		Addr:    ":8080",
		Handler: mux,

		// Only the header timeout is safe here: WebSocket connections are
		// long-lived, so a whole-request ReadTimeout/WriteTimeout would cut
		// them off.
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	fmt.Println(
		"Gold Sprint running at http://localhost:8080",
	)

	log.Fatal(httpServer.ListenAndServe())
}
