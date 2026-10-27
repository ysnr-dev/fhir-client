# 待合表示板(docs/waiting-board-design.md)。
module WaitingBoard
  # 受付番号(当日の連番)を持つ Appointment.identifier の system。frontend の appointmentHelpers と揃える。
  RECEPTION_NUMBER_IDENTIFIER_SYSTEM = "http://fhir-client.local/identifier/reception-number".freeze
end
