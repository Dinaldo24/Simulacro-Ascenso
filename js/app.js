const loginForm = document.querySelector("#login-form");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const togglePasswordButton = document.querySelector("#toggle-password");
const formMessage = document.querySelector("#form-message");
const currentYear = document.querySelector("#current-year");

currentYear.textContent = new Date().getFullYear();

togglePasswordButton.addEventListener("click", () => {
    const isPasswordVisible = passwordInput.type === "text";

    passwordInput.type = isPasswordVisible ? "password" : "text";
    togglePasswordButton.setAttribute("aria-pressed", String(!isPasswordVisible));
    togglePasswordButton.setAttribute(
        "aria-label",
        isPasswordVisible ? "Mostrar contraseña" : "Ocultar contraseña"
    );
});

function clearFieldError(input) {
    const errorMessage = document.querySelector(`#${input.id}-error`);

    input.removeAttribute("aria-invalid");
    errorMessage.textContent = "";
}

function showFieldError(input, message) {
    const errorMessage = document.querySelector(`#${input.id}-error`);

    input.setAttribute("aria-invalid", "true");
    errorMessage.textContent = message;
}

[usernameInput, passwordInput].forEach((input) => {
    input.addEventListener("input", () => {
        clearFieldError(input);
        formMessage.hidden = true;
        formMessage.textContent = "";
    });
});

loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearFieldError(usernameInput);
    clearFieldError(passwordInput);
    formMessage.hidden = true;
    formMessage.textContent = "";

    let firstInvalidInput = null;

    if (!usernameInput.value.trim()) {
        showFieldError(usernameInput, "Escribe tu usuario para continuar.");
        firstInvalidInput = usernameInput;
    }

    if (!passwordInput.value) {
        showFieldError(passwordInput, "Escribe tu contraseña para continuar.");
        if (!firstInvalidInput) {
            firstInvalidInput = passwordInput;
        }
    }

    if (firstInvalidInput) {
        firstInvalidInput.focus();
        return;
    }

    formMessage.textContent =
        "La pantalla está lista, pero el acceso todavía no valida usuarios. Para iniciar sesión de forma real, hace falta conectar un servidor.";
    formMessage.hidden = false;
});