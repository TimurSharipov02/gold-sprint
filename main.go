package main

import (
	"fmt"
	"log"
	"net/http"

	"gold-sprint/server"
)

func main() {

	http.Handle(
		"/",
		http.FileServer(
			http.Dir("./web"),
		),
	)

	http.HandleFunc(
		"/ws",
		server.WebSocketHandler,
	)

	fmt.Println(
		"Gold Sprint running at http://localhost:8080",
	)

	log.Fatal(
		http.ListenAndServe(
			":8080",
			nil,
		),
	)
}
