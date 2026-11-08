module Ssmix2
  module Cda
    # 拡張ストレージのコンテンツ定義ファイル _contents.xml(構築ガイドライン 2.2(7))。主文書が CDA なので添付(Reference)は書かない。
    module ContentsFile
      NAME = "_contents.xml".freeze
      CDA_MIME = "text/x-cda-r2+xml".freeze

      module_function

      def build(document_name:, file_name:, created_at:, vendor:)
        Nokogiri::XML::Builder.new(encoding: "UTF-8") do |xml|
          xml.Contents(createDateTime: Timestamp.xsd(created_at), createVendor: vendor, description: document_name) do
            xml.Document(name: file_name, mime: CDA_MIME, relDir: ".", description: document_name)
          end
        end.to_xml
      end

      # ssmix2_messages.files の 1 要素。
      def file(document_name:, file_name:, created_at:, vendor:)
        xml = build(document_name: document_name, file_name: file_name, created_at: created_at, vendor: vendor)
        { "name" => NAME, "body_base64" => Base64.strict_encode64(xml) }
      end
    end
  end
end
