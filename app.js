// ============================================================
// IVT EXPLORATEC 2026 - app.js
// Firebase modular SDK (Realtime Database + Authentication)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  onValue
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

// 1) REEMPLAZÁ estos valores por los de:
// Firebase Console > Configuración del proyecto > Tus apps > SDK web.
const firebaseConfig = {
  apiKey: "AIzaSyDWKx8RIrU5AqknqnRhmD39wT7nBm9LJEk",
  authDomain: "exploratech-cc0ee.firebaseapp.com",
  databaseURL: "https://exploratech-cc0ee-default-rtdb.firebaseio.com",
  projectId: "exploratech-cc0ee",
  messagingSenderId: "540602923935",
  appId: "1:540602923935:web:d0b6e46467bb68baf19baa",
  measurementId: "G-6BBVE9Y2QJ"
};

// 2) Pegá acá el UID de cada administrador autorizado.
// Lo encontrás en Firebase Console > Authentication > Users.
// No alcanza con ocultar el panel desde JavaScript: también hay que
// proteger Realtime Database mediante sus reglas.
const ADMIN_UIDS = [
  "GFgSUeMmkUgcWkUMIYWXTqC6vYf1"
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);

const surveyForm = $("surveyForm");
const loginForm = $("loginForm");
const submitButton = $("submitSurvey");
const loginButton = $("loginButton");
const photoInput = $("photoInput");

let selectedPhoto = null;
let responsesCache = {};
let stopResponsesListener = null;
let isSubmitting = false;

// -------------------------
// Utilidades de interfaz
// -------------------------

function showToast(message, duration = 3500) {
  const toast = $("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove("hidden");

  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

function setButtonLoading(button, loading, loadingText = "Procesando...") {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.textContent = loadingText;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

function showError(id, message = "") {
  const element = $(id);
  if (element) element.textContent = message;
}

function formatDate(timestamp) {
  if (!timestamp) return "Fecha no disponible";

  return new Date(timestamp).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

// -------------------------
// Fotografías guardadas directamente en Realtime Database
// -------------------------
const MAX_ORIGINAL_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSED_PHOTO_BYTES = 900 * 1024;

photoInput?.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  showError("photoError");
  selectedPhoto = null;

  if (!file) {
    clearPhotoPreview();
    return;
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    showError("photoError", "Elegí una imagen JPG, PNG o WEBP.");
    clearPhotoPreview();
    return;
  }

  if (file.size > MAX_ORIGINAL_PHOTO_BYTES) {
    showError("photoError", "La imagen original no puede superar los 8 MB.");
    clearPhotoPreview();
    return;
  }

  selectedPhoto = file;
  const preview = $("previewImage");
  const previewBox = $("photoPreview");
  const uploadZone = $("uploadZone");
  if (preview) {
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    const objectUrl = URL.createObjectURL(file);
    preview.src = objectUrl;
    preview.dataset.objectUrl = objectUrl;
  }
  $("photoName").textContent = file.name;
  $("photoSize").textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB original; se comprimirá al enviar`;
  previewBox?.classList.remove("hidden");
  uploadZone?.classList.add("hidden");
});

function clearPhotoPreview() {
  const preview = $("previewImage");
  if (preview?.dataset.objectUrl) {
    URL.revokeObjectURL(preview.dataset.objectUrl);
    delete preview.dataset.objectUrl;
  }
  if (preview) preview.removeAttribute("src");
  $("photoPreview")?.classList.add("hidden");
  $("uploadZone")?.classList.remove("hidden");
  if (photoInput) photoInput.value = "";
  selectedPhoto = null;
}

$("removePhoto")?.addEventListener("click", clearPhotoPreview);

async function compressPhotoToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No se pudo procesar la imagen.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  // JPEG reduce mucho el tamaño para poder guardar la imagen como texto Base64.
  for (const quality of [0.82, 0.75, 0.68, 0.60, 0.52]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_COMPRESSED_PHOTO_BYTES) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("No se pudo leer la imagen procesada."));
        reader.readAsDataURL(blob);
      });
      return dataUrl;
    }
  }
  throw new Error("La imagen sigue siendo demasiado pesada. Elegí una imagen más pequeña.");
}

// -------------------------
// Contador de comentarios
// -------------------------

$("comments")?.addEventListener("input", (event) => {
  $("charCount").textContent = `${event.target.value.length} / 1500`;
});

// -------------------------
// Recolección de respuestas
// -------------------------

function getSurveyAnswers() {
  const highlights = [
    ...document.querySelectorAll('input[name="highlights"]:checked')
  ].map((input) => input.value);

  const getRadio = (name) =>
    document.querySelector(`input[name="${name}"]:checked`)?.value || "";

  return {
    highlights,
    answer_projects: getRadio("answer_projects"),
    answer_learning: getRadio("answer_learning"),
    answer_robotics: getRadio("answer_robotics"),
    answer_oral: getRadio("answer_oral"),
    answer_games: getRadio("answer_games"),
    comments: $("comments")?.value.trim() || ""
  };
}

function validateSurvey(answers) {
  if (answers.highlights.length === 0) {
    showError("highlightsError", "Seleccioná al menos una opción.");
    $("highlightsGroup")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }

  showError("highlightsError");

  const requiredAnswers = [
    answers.answer_projects,
    answers.answer_learning,
    answers.answer_robotics,
    answers.answer_oral,
    answers.answer_games
  ];

  if (requiredAnswers.some((answer) => !answer)) {
    showToast("Completá todas las preguntas antes de enviar.");
    return false;
  }

  return true;
}

surveyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) return;

  const answers = getSurveyAnswers();

  if (!validateSurvey(answers)) return;

  isSubmitting = true;
  setButtonLoading(submitButton, true, "Enviando...");

  try {
    // Se crea una clave única para esta respuesta.
    let photoDataUrl = null;
    if (selectedPhoto) {
      showToast("Comprimiendo fotografía...", 5000);
      photoDataUrl = await compressPhotoToDataUrl(selectedPhoto);
    }

    const newResponseRef = push(ref(db, "responses"));
    const responseData = {
      ...answers,
      ...(photoDataUrl ? {
        photoDataUrl,
        photoName: selectedPhoto.name.slice(0, 200),
        photoType: "image/jpeg"
      } : {}),
      createdAt: Date.now()
    };

    await set(newResponseRef, responseData);

    surveyForm.classList.add("hidden");
    $("successMessage")?.classList.remove("hidden");
    $("successMessage")?.scrollIntoView({ behavior: "smooth", block: "start" });

    showToast("¡Tu respuesta se guardó correctamente!");
  } catch (error) {
    console.error("Error al guardar la encuesta:", error);

    let message = error.message?.includes("imagen")
      ? error.message
      : "No se pudo enviar la encuesta. Intentá nuevamente.";

    if (error.code === "PERMISSION_DENIED" || error.code === "database/permission-denied") {
      message = "Firebase rechazó la operación. Revisá las reglas de Realtime Database y el UID del administrador.";
    } else if (String(error.message || "").includes("demasiado pesada")) {
      message = error.message;
    } else if (!navigator.onLine) {
      message = "No hay conexión a Internet. Revisá tu conexión e intentá nuevamente.";
    }

    showToast(message, 5000);
  } finally {
    isSubmitting = false;
    setButtonLoading(submitButton, false);
  }
});

// Permite enviar otra respuesta sin recargar la página.
$("newResponse")?.addEventListener("click", () => {
  surveyForm?.reset();
  clearPhotoPreview();
  showError("highlightsError");

  $("charCount").textContent = "0 / 1500";
  $("successMessage")?.classList.add("hidden");
  surveyForm?.classList.remove("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });
});

// -------------------------
// Modal de administradores
// -------------------------

$("openLogin")?.addEventListener("click", () => {
  $("loginModal")?.classList.remove("hidden");
  showError("loginError");
});

function closeLoginModal() {
  $("loginModal")?.classList.add("hidden");
  showError("loginError");
}

$("closeLogin")?.addEventListener("click", closeLoginModal);

$("loginModal")?.addEventListener("click", (event) => {
  if (event.target === $("loginModal")) closeLoginModal();
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;

  showError("loginError");

  setButtonLoading(loginButton, true, "Ingresando...");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged verifica si el UID está autorizado.
  } catch (error) {
    console.error("Error de inicio de sesión:", error);

    const messages = {
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/user-not-found": "No existe una cuenta con ese correo.",
      "auth/wrong-password": "La contraseña es incorrecta.",
      "auth/invalid-email": "El correo electrónico no es válido.",
      "auth/too-many-requests": "Demasiados intentos. Probá más tarde."
    };

    showError(
      "loginError",
      messages[error.code] || "No se pudo iniciar sesión. Revisá los datos."
    );
  } finally {
    setButtonLoading(loginButton, false);
  }
});

// -------------------------
// Autenticación y permisos
// -------------------------

function isAdmin(user) {
  return Boolean(user && ADMIN_UIDS.includes(user.uid));
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showAdminPanel(false);

    if (stopResponsesListener) {
      stopResponsesListener();
      stopResponsesListener = null;
    }

    return;
  }

  if (!isAdmin(user)) {
    await signOut(auth);
    showAdminPanel(false);
    showError("loginError", "Esta cuenta no tiene permisos de administrador.");
    $("loginModal")?.classList.remove("hidden");
    return;
  }

  closeLoginModal();
  showAdminPanel(true);
  listenToResponses();
});

function showAdminPanel(show) {
  $("surveySection")?.classList.toggle("hidden", show);
  $("adminSection")?.classList.toggle("hidden", !show);

  if (show) {
    $("adminSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

$("logoutButton")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    responsesCache = {};
    showAdminPanel(false);
    showToast("Sesión cerrada.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    console.error(error);
    showToast("No se pudo cerrar la sesión.");
  }
});

// -------------------------
// Panel: lectura en tiempo real
// -------------------------

function listenToResponses() {
  if (stopResponsesListener) stopResponsesListener();

  const responsesRef = ref(db, "responses");

  stopResponsesListener = onValue(
    responsesRef,
    (snapshot) => {
      responsesCache = snapshot.val() || {};
      renderDashboard(responsesCache);
    },
    (error) => {
      console.error("Error leyendo respuestas:", error);
      showToast("No se pudieron cargar las respuestas. Revisá las reglas de Firebase.");
    }
  );
}

function renderDashboard(responses) {
  const entries = Object.entries(responses)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  $("totalResponses").textContent = entries.length;

  renderHighlightStats(entries);
  renderResponses(entries);
}

function renderHighlightStats(entries) {
  const container = $("highlightStats");
  if (!container) return;

  const counts = {};

  entries.forEach((entry) => {
    (Array.isArray(entry.highlights) ? entry.highlights : []).forEach((item) => {
      counts[item] = (counts[item] || 0) + 1;
    });
  });

  const items = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...items.map((item) => item[1]));

  if (!items.length) {
    container.innerHTML = '<p class="muted">Todavía no hay respuestas.</p>';
    return;
  }

  container.innerHTML = items.map(([label, count]) => `
    <div class="bar-row">
      <span>${escapeHTML(label)}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(count / max) * 100}%"></div>
      </div>
      <strong class="bar-count">${count}</strong>
    </div>
  `).join("");
}

function renderResponses(entries) {
  const container = $("responsesList");
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = '<p class="muted">Todavía no se recibieron encuestas.</p>';
    return;
  }

  container.innerHTML = entries.map((entry, index) => {
    const highlights = Array.isArray(entry.highlights)
      ? entry.highlights.join(", ")
      : "";


    const photo = entry.photoDataUrl
      ? `<a href="${escapeHTML(entry.photoDataUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir fotografía de la respuesta">
           <img class="response-photo" src="${escapeHTML(entry.photoDataUrl)}" alt="Fotografía enviada" loading="lazy">
         </a>`
      : "";

    return `
      <article class="response-item">
        <div class="response-top">
          <strong>Respuesta #${entries.length - index}</strong>
          <time>${escapeHTML(formatDate(entry.createdAt))}</time>
        </div>
        <p class="response-themes"><strong>Destacó:</strong> ${escapeHTML(highlights || "Sin selección")}</p>
        <p class="response-detail"><strong>Proyectos:</strong> ${escapeHTML(entry.answer_projects || "—")}</p>
        <p class="response-detail"><strong>Aprendizajes:</strong> ${escapeHTML(entry.answer_learning || "—")}</p>
        <p class="response-detail"><strong>Robótica:</strong> ${escapeHTML(entry.answer_robotics || "—")}</p>
        <p class="response-detail"><strong>Expresión oral:</strong> ${escapeHTML(entry.answer_oral || "—")}</p>
        <p class="response-detail"><strong>Videojuegos:</strong> ${escapeHTML(entry.answer_games || "—")}</p>
        <p class="response-detail"><strong>Comentarios:</strong> ${escapeHTML(entry.comments || "Sin comentarios")}</p>
        ${photo}
      </article>
    `;
  }).join("");
}

// -------------------------
// Exportar respuestas a CSV
// -------------------------

function csvCell(value) {
  const safeValue = String(value ?? "").replace(/"/g, '""');
  return `"${safeValue}"`;
}

$("exportCsv")?.addEventListener("click", () => {
  const entries = Object.entries(responsesCache)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  if (!entries.length) {
    showToast("No hay respuestas para exportar.");
    return;
  }

  const headers = [
    "ID",
    "Fecha",
    "Qué destacó",
    "Proyectos",
    "Aprendizajes",
    "Robótica",
    "Expresión oral",
    "Videojuegos",
    "Comentarios",
    "Fotografía incluida"
  ];

  const rows = entries.map((entry) => [
    entry.id,
    formatDate(entry.createdAt),
    Array.isArray(entry.highlights) ? entry.highlights.join(" | ") : "",
    entry.answer_projects,
    entry.answer_learning,
    entry.answer_robotics,
    entry.answer_oral,
    entry.answer_games,
    entry.comments,
    entry.photoDataUrl ? "Sí" : "No"
  ]);

  // BOM para que Excel interprete correctamente los acentos.
  const csv = "\uFEFF" + [
    headers,
    ...rows
  ].map((row) => row.map(csvCell).join(";")).join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `IVT_Exploratec_2026_respuestas_${new Date().toISOString().slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
  showToast("CSV descargado correctamente.");
});

// -------------------------
// Persistencia de sesión
// -------------------------

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("No se pudo configurar la persistencia:", error);
});

console.log("IVT Exploratec 2026: app.js cargado.");
