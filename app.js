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

const firebaseConfig = {
  apiKey: "AIzaSyDWKx8RIrU5AqknqnRhmD39wT7nBm9LJEk",
  authDomain: "exploratech-cc0ee.firebaseapp.com",
  databaseURL: "https://exploratech-cc0ee-default-rtdb.firebaseio.com",
  projectId: "exploratech-cc0ee",
  messagingSenderId: "540602923935",
  appId: "1:540602923935:web:d0b6e46467bb68baf19baa",
  measurementId: "G-6BBVE9Y2QJ"
};

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
  $("heroSection")?.classList.toggle("hidden", show); // Oculta o muestra el banner principal
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
  $("totalPhotos").textContent = entries.filter((e) => e.photoDataUrl).length;

  renderHighlightStats(entries);
  renderSingleChoiceStats(entries, "answer_projects", "projectsStats");
  renderSingleChoiceStats(entries, "answer_learning", "learningStats");
  renderSingleChoiceStats(entries, "answer_robotics", "roboticsStats");
  renderSingleChoiceStats(entries, "answer_oral", "oralStats");
  renderSingleChoiceStats(entries, "answer_games", "gamesStats");

  renderPhotosGallery(entries);
  renderCommentsList(entries);
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

function renderSingleChoiceStats(entries, fieldKey, containerId) {
  const container = $(containerId);
  if (!container) return;

  const counts = {};

  entries.forEach((entry) => {
    const value = entry[fieldKey];
    if (value) {
      counts[value] = (counts[value] || 0) + 1;
    }
  });

  const items = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...items.map((item) => item[1]));

  if (!items.length) {
    container.innerHTML = '<p class="muted">Todavía no hay respuestas registradas.</p>';
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

function renderPhotosGallery(entries) {
  const container = $("photosGallery");
  if (!container) return;

  const entriesWithPhotos = entries.filter((entry) => entry.photoDataUrl);

  if (!entriesWithPhotos.length) {
    container.innerHTML = '<p class="muted">Todavía no se subieron fotografías.</p>';
    return;
  }

  container.innerHTML = entriesWithPhotos.map((entry, index) => {
    const fileName = entry.photoName
      ? entry.photoName.replace(/\.[^/.]+$/, "") + ".jpg"
      : `IVT_Exploratec_foto_${entriesWithPhotos.length - index}.jpg`;

    return `
      <div class="photo-card">
        <a href="${escapeHTML(entry.photoDataUrl)}" target="_blank" rel="noopener noreferrer" title="Ver en tamaño completo">
          <img src="${escapeHTML(entry.photoDataUrl)}" alt="Fotografía de visitante" loading="lazy">
        </a>
        <div class="photo-card-footer">
          <time>${escapeHTML(formatDate(entry.createdAt))}</time>
          <a class="btn-download-photo" href="${escapeHTML(entry.photoDataUrl)}" download="${escapeHTML(fileName)}">↓ Descargar</a>
        </div>
      </div>
    `;
  }).join("");
}

function renderCommentsList(entries) {
  const container = $("commentsList");
  if (!container) return;

  const entriesWithComments = entries.filter((entry) => entry.comments && entry.comments.trim().length > 0);

  if (!entriesWithComments.length) {
    container.innerHTML = '<p class="muted">Todavía no se escribieron comentarios.</p>';
    return;
  }

  container.innerHTML = entriesWithComments.map((entry, index) => `
    <article class="response-item">
      <div class="response-top">
        <strong>Comentario #${entriesWithComments.length - index}</strong>
        <time>${escapeHTML(formatDate(entry.createdAt))}</time>
      </div>
      <p class="response-detail">${escapeHTML(entry.comments)}</p>
    </article>
  `).join("");
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

  const csv = "\uFEFF" + [
    headers,
    ...rows
  ].map((row) => row.map(csvCell).join(";")).join("\n");

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

$("logoHome")?.addEventListener("click", (event) => {
  event.preventDefault();

  // Si el usuario es administrador y está viendo el panel, lo oculta y vuelve a mostrar la encuesta y el banner
  $("adminSection")?.classList.add("hidden");
  $("surveySection")?.classList.remove("hidden");
  $("heroSection")?.classList.remove("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });
});
