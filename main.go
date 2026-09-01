// Gold Sprint is a static site — the race engine and everything else run in the
// browser (see web/). This is just a static file server for local development;
// hosting is a plain static deploy (Vercel, Netlify, Cloudflare Pages, …).
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           http.FileServer(http.Dir("./web")),
		ReadHeaderTimeout: 5 * time.Second,
	}

	fmt.Printf("Gold Sprint on http://localhost:%s\n", port)
	log.Fatal(srv.ListenAndServe())
}
