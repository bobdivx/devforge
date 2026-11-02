{{- define "devforge.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "devforge.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "devforge.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "devforge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "devforge.selectorLabels" -}}
app.kubernetes.io/name: {{ include "devforge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: server
{{- end }}

{{- define "devforge.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "devforge.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "devforge.appsNamespace" -}}
{{- default .Release.Namespace .Values.apps.namespace }}
{{- end }}

{{- /* « per-project » ou « single » (valeur normalisée pour le serveur). */}}
{{- define "devforge.namespaceMode" -}}
{{- $m := lower (toString .Values.apps.namespaceMode) | replace "_" "-" }}
{{- if or (eq $m "single") (eq $m "namespace") }}single
{{- else if or (eq $m "perproject") (eq $m "per-project") (eq $m "project") }}per-project
{{- else }}{{ fail (printf "apps.namespaceMode invalide : %s (perProject|single)" .Values.apps.namespaceMode) }}
{{- end }}
{{- end }}

{{- define "devforge.pgName" -}}
{{- printf "%s-postgres" (include "devforge.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
