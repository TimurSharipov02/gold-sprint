console.log("GOLD SPRINT APP LOADED");


/* =========================
   ELEMENTS
   ========================= */

const raceScreen =
    document.getElementById("race-screen");

const setupScreen =
    document.getElementById("setup-screen");

const navRace =
    document.getElementById("nav-race");

const navSetup =
    document.getElementById("nav-setup");

const backButton =
    document.getElementById("back-button");

const startButton =
    document.getElementById("start-button");

const distanceSelect =
    document.getElementById("setup-distance");

const wheel1 =
    document.getElementById("wheel-1");

const wheel2 =
    document.getElementById("wheel-2");

const saveSettings =
    document.getElementById("save-settings");

const status =
    document.getElementById("status");

const raceDistanceHeader =
    document.getElementById("race-distance-header");

const countdownOverlay =
    document.getElementById("countdown-overlay");

const countdownNumber =
    document.getElementById("countdown-number");

const winnerOverlay =
    document.getElementById("winner-overlay");

const winnerNumber =
    document.getElementById("winner-number");

const winnerFlash =
    document.getElementById("winner-flash");


/* =========================
   RACE STATE
   ========================= */

let previousRaceState = "";

let winnerShown = 0;

let winnerFlashTimer = null;

let winnerTextTimer = null;


/* =========================
   SETTINGS
   ========================= */

const settings = {

    distance: 250,

    wheels: {

        1: 2105,

        2: 2105

    }

};


/* =========================
   WEBSOCKET
   ========================= */

const socket =
    new WebSocket(`ws://${location.host}/ws`);


socket.onopen = () => {

    console.log(
        "WEBSOCKET CONNECTED"
    );

    status.textContent =
        "READY";
};


socket.onclose = () => {

    console.log(
        "WEBSOCKET CLOSED"
    );

    status.textContent =
        "DISCONNECTED";
};


socket.onerror = (error) => {

    console.error(
        "WEBSOCKET ERROR",
        error
    );
};


socket.onmessage = (event) => {

    const data =
        JSON.parse(event.data);

    if (data.type === "race") {

        handleRaceData(data);

    } else {

        updateRider(data);

    }

};


/* =========================
   NAVIGATION
   ========================= */

function showScreen(screen) {

    const isRace =
        screen === "race";


    raceScreen.classList.toggle(
        "hidden",
        !isRace
    );


    setupScreen.classList.toggle(
        "hidden",
        isRace
    );


    navRace.classList.toggle(
        "active",
        isRace
    );


    navSetup.classList.toggle(
        "active",
        !isRace
    );

}


navRace.addEventListener(
    "click",
    () => showScreen("race")
);


navSetup.addEventListener(
    "click",
    () => showScreen("setup")
);


backButton.addEventListener(
    "click",
    () => showScreen("race")
);


/* =========================
   SETTINGS
   ========================= */

saveSettings.addEventListener(
    "click",
    () => {

        settings.distance =
            Number(
                distanceSelect.value
            );


        settings.wheels[1] =
            Number(
                wheel1.value
            );


        settings.wheels[2] =
            Number(
                wheel2.value
            );


        console.log(
            "SETTINGS SAVED",
            settings
        );


        updateRaceDistance();

        showScreen("race");

    }
);


function updateRaceDistance() {

    raceDistanceHeader.textContent =
        `${settings.distance} M`;


    document.getElementById(
        "distance-limit-1"
    ).textContent =
        settings.distance;


    document.getElementById(
        "distance-limit-2"
    ).textContent =
        settings.distance;

}


/* =========================
   START RACE
   ========================= */

startButton.addEventListener(
    "click",
    () => {

        if (
            socket.readyState !==
            WebSocket.OPEN
        ) {

            console.error(
                "WEBSOCKET IS NOT OPEN"
            );

            return;

        }


        const command = {

            type: "start",

            distance:
                settings.distance,

            wheel1:
                settings.wheels[1],

            wheel2:
                settings.wheels[2]

        };


        console.log(
            "SENDING START:",
            command
        );


        socket.send(
            JSON.stringify(command)
        );

    }
);


/* =========================
   RIDER DATA
   ========================= */

function updateRider(data) {

    const rider =
        data.rider;


    document.getElementById(
        `speed-${rider}`
    ).textContent =
        data.speed.toFixed(1);


    document.getElementById(
        `cadence-${rider}`
    ).textContent =
        Math.round(data.cadence);


    document.getElementById(
        `distance-${rider}`
    ).textContent =
        data.distance.toFixed(1);


    const progress =
        Math.min(
            data.distance /
            settings.distance *
            100,
            100
        );


    document.getElementById(
        `progress-${rider}`
    ).style.width =
        `${progress}%`;

}


/* =========================
   RESET WINNER UI
   ========================= */

function resetWinnerUI() {

    clearTimeout(
        winnerFlashTimer
    );

    clearTimeout(
        winnerTextTimer
    );


    winnerFlashTimer = null;

    winnerTextTimer = null;


    winnerFlash.classList.add(
        "hidden"
    );

    winnerFlash.classList.remove(
        "blue",
        "red"
    );


    winnerOverlay.classList.add(
        "hidden"
    );


    winnerNumber.textContent = "";


    document.body.classList.remove(
        "winner-1",
        "winner-2"
    );


    winnerShown = 0;

}


/* =========================
   WINNER
   ========================= */

function showWinner(winner) {

    // Победный фон
    document.body.classList.remove(
        "winner-1",
        "winner-2"
    );

    document.body.classList.add(
        `winner-${winner}`
    );


    // Текст победителя
    winnerNumber.textContent =
        `RIDER ${String(winner).padStart(2, "0")} WINS`;

    winnerOverlay.classList.remove("hidden");


    // Запускаем мигание
    winnerFlash.classList.remove(
        "hidden",
        "blue",
        "red"
    );

    winnerFlash.classList.add(
        winner === 1 ? "blue" : "red"
    );
}

function stopWinnerScreen() {

    winnerFlash.classList.add("hidden");

    winnerFlash.classList.remove(
        "blue",
        "red"
    );

    winnerOverlay.classList.add("hidden");

    startButton.disabled = false;
}

document.addEventListener("pointerdown", () => {

    if (
        !winnerOverlay.classList.contains("hidden")
    ) {
        stopWinnerScreen();
    }

});


/* =========================
   WINNER SEQUENCE
   ========================= */

function startWinnerSequence(winner) {

    /*
       Полностью сбрасываем
       предыдущую последовательность.
    */

    clearTimeout(
        winnerFlashTimer
    );

    clearTimeout(
        winnerTextTimer
    );


    winnerFlashTimer = null;

    winnerTextTimer = null;


    winnerShown = 0;


    /*
       Убираем старый winner UI.
    */

    winnerOverlay.classList.add(
        "hidden"
    );

    winnerNumber.textContent = "";


    winnerFlash.classList.add(
        "hidden"
    );

    winnerFlash.classList.remove(
        "blue",
        "red"
    );


    /*
       Фиксируем победителя.
    */

    document.body.classList.remove(
        "winner-1",
        "winner-2"
    );

    document.body.classList.add(
        `winner-${winner}`
    );


    /*
       Запускаем ОДНУ вспышку.
    */

    void winnerFlash.offsetWidth;


    winnerFlash.classList.remove(
        "hidden"
    );


    winnerFlash.classList.add(
        winner === 1
            ? "blue"
            : "red"
    );


    /*
       После окончания анимации
       полностью убираем flash.
    */

    winnerFlashTimer =
        setTimeout(
            () => {

                winnerFlash.classList.add(
                    "hidden"
                );

                winnerFlash.classList.remove(
                    "blue",
                    "red"
                );


                /*
                   Теперь спокойно ждём
                   15 секунд.
                */

                winnerTextTimer =
                    setTimeout(
                        () => {

                            showWinner(
                                winner
                            );

                        },
                        15000
                    );

            },
            1400
        );

}


/* =========================
   RACE DATA
   ========================= */

function handleRaceData(data) {

    raceDistanceHeader.textContent =
        `${data.distance} M`;


    /*
       Не обрабатываем одно и то же
       состояние повторно.
    */

    if (
        data.state ===
        previousRaceState &&
        data.state === "finished"
    ) {

        return;

    }


    previousRaceState =
        data.state;


    switch (data.state) {


        /* =====================
           READY
           ===================== */

        case "ready":

            countdownOverlay.classList.add("hidden");

            winnerFlash.classList.add("hidden");
            winnerFlash.classList.remove("blue", "red");

            winnerOverlay.classList.add("hidden");

            status.textContent = "READY";

            startButton.disabled = false;

            distanceSelect.disabled = false;

            document.body.classList.remove(
                "winner-1",
                "winner-2"
            );

            break;


        /* =====================
           COUNTDOWN
           ===================== */

        case "countdown":

            startButton.disabled =
                true;


            countdownOverlay.classList.remove(
                "hidden"
            );


            countdownNumber.textContent =
                data.countdown;


            /*
               Перезапускаем
               animation для каждой цифры.
            */

            countdownNumber.style.animation =
                "none";


            void countdownNumber.offsetWidth;


            countdownNumber.style.animation =
                "countdownNumber 0.9s cubic-bezier(0.2, 0.8, 0.2, 1)";


            break;


        /* =====================
           RUNNING
           ===================== */

        case "running":

            /*
               На всякий случай
               убираем countdown.
            */

            countdownOverlay.classList.add(
                "hidden"
            );


            status.classList.remove(
                "countdown"
            );


            status.textContent =
                `RUNNING // ${data.elapsed.toFixed(1)} S`;


            startButton.disabled =
                true;


            break;


        /* =====================
           FINISHED
           ===================== */

        case "finished":

            status.textContent =
                `>>> RIDER ${data.winner} <<<`;

            startButton.disabled = true;

            showWinner(data.winner);

            break;

    }

}


/* =========================
   INITIALIZATION
   ========================= */

updateRaceDistance();

showScreen("race");