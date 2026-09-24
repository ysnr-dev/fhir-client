module LabImport
  # 取込を中止する理由(MSH が無い、結果が 0 件、文字コードを判定できない など)。
  # Master::BaseController が MasterImport::ImportError を 422 に変換するので、
  # それを継承して同じレールに乗せる。
  class ImportError < MasterImport::ImportError; end
end
